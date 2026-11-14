# Code snapshots and rollback

This repository stores the website, server, browser extension, dependency
lockfile, and operational scripts. Household data, receipt history, photos,
backups, browser sessions, credentials, and installed dependencies stay outside
Git. Use [Backup and recovery](BACKUP-RECOVERY.txt) for household data and
[Contributing](CONTRIBUTING.md) for development and release guidance.

When authorized to commit and publish, save a working code snapshot before
a change and a validated snapshot afterward. Uncommitted changes are not available as saved
rollback points. Check snapshots with `git log --oneline --decorate`.

To undo a specific committed change while preserving history:

```sh
git status
git revert <commit-id>
git push
```

Resolve or save unrelated uncommitted work before reverting. Restart the configured
source launcher/task after server changes. For an installer setup, use its Start
menu Stop/Open actions; normal installer users should update with a release rather
than editing installed files. Reload the browser helper after extension changes
and refresh the website after frontend changes. Reverting published code is a new
commit; do not rewrite shared history or move a release tag without authorization.

Code rollback does not undo database changes. If a change modifies stored data or
the database schema, make a full data backup before applying it and check whether
the older code supports that schema before rolling back.
