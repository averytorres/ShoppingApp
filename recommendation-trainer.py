"""Local, single-request JSON worker for household group-count recommendations.

Only completed earlier shopping windows train the model. Exported models contain
numeric tree parameters, never receipt identities or original training examples.
"""
import os
for _name in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ[_name] = '1'

import json
import math
import sys

DAY = 86400000
FORMAT = 'home-grocery-hist-gradient-boosting'


def export_model(model):
    """Export sklearn's numeric histogram trees; leaf values include shrinkage."""
    import numpy as np
    from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
    if isinstance(model, HistGradientBoostingClassifier):
        if list(model.classes_) != [0, 1]:
            raise ValueError('Only binary classification is supported')
        link = 'logistic'
    elif isinstance(model, HistGradientBoostingRegressor) and model.loss == 'poisson':
        link = 'exp'
    else:
        raise ValueError('Unsupported recommendation model')
    baseline = np.asarray(model._baseline_prediction).reshape(-1)
    if len(baseline) != 1 or not np.isfinite(baseline).all():
        raise ValueError('Invalid model baseline')
    trees = []
    for iteration in model._predictors:
        if len(iteration) != 1:
            raise ValueError('Only single-output models are supported')
        nodes = []
        for node in iteration[0].nodes:
            if node['is_categorical']:
                raise ValueError('Categorical tree splits are unsupported')
            leaf = bool(node['is_leaf'])
            value = float(node['value'])
            if not math.isfinite(value):
                raise ValueError('Invalid model leaf')
            record = dict(isLeaf=leaf, value=value)
            if not leaf:
                threshold = float(node['num_threshold'])
                if not math.isfinite(threshold):
                    raise ValueError('Invalid model threshold')
                record.update(feature=int(node['feature_idx']), threshold=threshold,
                              left=int(node['left']), right=int(node['right']),
                              missingLeft=bool(node['missing_go_to_left']))
            nodes.append(record)
        trees.append(dict(nodes=nodes))
    return dict(format=FORMAT, version=1, inputDtype='float32', featureCount=int(model.n_features_in_),
                baseline=float(baseline[0]), link=link, trees=trees)


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def train(request):
    import numpy as np
    from sklearn.ensemble import HistGradientBoostingRegressor
    if not isinstance(request, dict):
        raise ValueError('Expected a JSON object')
    count = request.get('featureCount')
    current = request.get('currentT')
    frames = request.get('frames')
    if not isinstance(count, int) or isinstance(count, bool) or not 1 <= count <= 1024:
        raise ValueError('Invalid featureCount')
    if not finite_number(current) or not isinstance(frames, list):
        raise ValueError('Invalid currentT or frames')
    xs, ys, weights = [], [], []
    completed, used, previous = 0, 0, None
    for frame in frames:
        if not isinstance(frame, dict) or not finite_number(frame.get('t')):
            raise ValueError('Invalid frame timestamp')
        t = frame['t']
        if previous is not None and t <= previous:
            raise ValueError('Frames must have unique increasing timestamps')
        previous = t
        if t + 7 * DAY > current:
            continue
        if not isinstance(frame.get('shopping'), bool) or not isinstance(frame.get('groups'), list):
            raise ValueError('Invalid completed frame')
        groups = frame['groups']
        if not frame['shopping'] or not groups:
            continue
        completed += 1
        total_n = 0
        validated = []
        for group in groups:
            if not isinstance(group, dict):
                raise ValueError('Invalid group')
            n, target, features = group.get('n'), group.get('targetCount'), group.get('features')
            if not isinstance(n, int) or isinstance(n, bool) or n < 1:
                raise ValueError('Invalid group membership count')
            if not isinstance(target, int) or isinstance(target, bool) or not 0 <= target <= n:
                raise ValueError('Invalid group target count')
            if not isinstance(features, list) or len(features) != count or not all(map(finite_number, features)):
                raise ValueError('Invalid group features')
            validated.append((features, target / n, n))
            total_n += n
        for features, target, n in validated:
            xs.append(features); ys.append(target); weights.append(n / total_n)
        used += len(groups)
    info = dict(completedShoppingFrames=completed, trainingRows=used)
    if completed < 4:
        return dict(status='cold-prefix', training=info)
    x = np.asarray(xs, dtype=np.float32)
    if not np.isfinite(x).all():
        raise ValueError('Features exceed float32 range')
    y = np.asarray(ys, dtype=np.float64)
    w = np.asarray(weights, dtype=np.float64)
    w *= len(w) / w.sum()
    if y.sum() == 0:
        return dict(status='zero-target', training=info, constantPrediction=0)
    model = HistGradientBoostingRegressor(loss='poisson', max_iter=100,
        max_leaf_nodes=7, min_samples_leaf=20, l2_regularization=10,
        learning_rate=.05, early_stopping=False, random_state=7)
    model.fit(x, y, sample_weight=w)
    return dict(status='trained', training=info, model=export_model(model))


def main():
    try:
        request = json.load(sys.stdin)
        result = train(request)
        json.dump(result, sys.stdout, allow_nan=False, separators=(',', ':'))
        sys.stdout.write('\n')
    except Exception as error:
        # Never serialize the request or receipt data when reporting an error.
        print(json.dumps(dict(status='error', message=str(error))), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
