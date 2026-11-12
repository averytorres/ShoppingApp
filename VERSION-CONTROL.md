# Code snapshots and rollback

This private repository stores the website, server, browser extension, dependency
lockfile, and operational scripts. Household data, receipt history, photos,
backups, browser sessions, credentials, and installed dependencies stay outside
Git. Use BACKUP-RECOVERY.txt to back up or recover household data.

Before a change, commit a working code snapshot. After checking the change,
commit it and push it to GitHub. Uncommitted changes are not available as saved
rollback points. Check snapshots with `git log --oneline --decorate`.

To undo a specific committed change while preserving history:

```sh
git status
git revert <commit-id>
git push
```

Resolve or save unrelated uncommitted work before reverting. Restart the Home
Grocery Server task after changing server code, reload the browser extension
after changing extension code, and refresh the website after frontend changes.

Code rollback does not undo database changes. If a change modifies stored data or
the database schema, make a full data backup before applying it and check whether
the older code supports that schema before rolling back.
