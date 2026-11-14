'use strict';

const FORMAT = 'home-grocery-hist-gradient-boosting';

function validateModel(model) {
  if (!model || model.format !== FORMAT || model.version !== 1 ||
      !Number.isInteger(model.featureCount) || model.featureCount < 1 || model.featureCount > 1024 ||
      !Number.isFinite(model.baseline) || !['exp', 'logistic', 'identity'].includes(model.link) ||
      (model.inputDtype !== undefined && model.inputDtype !== 'float32') ||
      !Array.isArray(model.trees) || model.trees.length > 10000) throw new Error('Invalid recommendation model');
  for (const tree of model.trees) {
    if (!tree || !Array.isArray(tree.nodes) || tree.nodes.length < 1 || tree.nodes.length > 100000) throw new Error('Invalid recommendation tree');
    const seen = new Set();
    function visit(index) {
      if (!Number.isInteger(index) || index < 0 || index >= tree.nodes.length || seen.has(index)) throw new Error('Invalid recommendation tree structure');
      seen.add(index);
      const node = tree.nodes[index];
      if (!node || typeof node.isLeaf !== 'boolean' || !Number.isFinite(node.value)) throw new Error('Invalid recommendation node');
      if (!node.isLeaf) {
        if (!Number.isInteger(node.feature) || node.feature < 0 || node.feature >= model.featureCount ||
            !Number.isFinite(node.threshold) || typeof node.missingLeft !== 'boolean') throw new Error('Invalid recommendation split');
        visit(node.left); visit(node.right);
      }
    }
    visit(0);
    if (seen.size !== tree.nodes.length) throw new Error('Unreachable recommendation nodes');
  }
  return model;
}

function checkFeatures(features, count, dtype) {
  if (!Array.isArray(features) && !ArrayBuffer.isView(features)) throw new Error('Invalid recommendation features');
  if (features.length !== count) throw new Error('Wrong recommendation feature count');
  for (const value of features) {
    if (value !== null && (typeof value !== 'number' || (!Number.isFinite(value) && !Number.isNaN(value)))) throw new Error('Invalid recommendation feature value');
    if (dtype === 'float32' && Number.isFinite(value) && value !== null && !Number.isFinite(Math.fround(value))) throw new Error('Recommendation feature exceeds model range');
  }
}

function scoreValidated(model, features) {
  checkFeatures(features, model.featureCount, model.inputDtype);
  let total = model.baseline;
  for (const tree of model.trees) {
    let node = tree.nodes[0];
    while (!node.isLeaf) {
      const supplied = features[node.feature];
      const value = supplied === null ? null : model.inputDtype === 'float32' ? Math.fround(supplied) : supplied;
      if (value !== null && !Number.isNaN(value) && !Number.isFinite(value)) throw new Error('Recommendation feature exceeds model range');
      const left = value === null || Number.isNaN(value) ? node.missingLeft : value <= node.threshold;
      node = tree.nodes[left ? node.left : node.right];
    }
    total += node.value;
  }
  if (!Number.isFinite(total)) throw new Error('Nonfinite recommendation score');
  return total;
}

function linked(model, raw) {
  const result = model.link === 'exp' ? Math.exp(raw) : model.link === 'logistic' ?
    (raw >= 0 ? 1 / (1 + Math.exp(-raw)) : Math.exp(raw) / (1 + Math.exp(raw))) : raw;
  if (!Number.isFinite(result)) throw new Error('Nonfinite recommendation prediction');
  return result;
}

function predictRaw(model, features) { validateModel(model); return scoreValidated(model, features); }
function predict(model, features) { return linked(model, predictRaw(model, features)); }
function predictMany(model, rows) {
  validateModel(model);
  if (!Array.isArray(rows)) throw new Error('Invalid recommendation feature rows');
  return rows.map(row => linked(model, scoreValidated(model, row)));
}

module.exports = { validateModel, predictRaw, predict, predictMany };
