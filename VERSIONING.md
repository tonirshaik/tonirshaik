# Website versioning

The version badge beside **Tonir Shaik** in the gallery header reads from `version.json`.

## Automatic version updates

When a code/content pull request is merged into `main`, GitHub Actions opens a separate version-bump pull request. Review and merge that generated PR to publish the new version. This keeps changes off `main` until a PR is reviewed.

- **Patch**: any merged change by default, e.g. `1.0.0 → 1.0.1`.
- **Minor**: add the `feature` label to the original pull request, e.g. `1.0.1 → 1.1.0`.
- **Major**: add the `major` label to the original pull request, e.g. `1.1.0 → 2.0.0`.

Version-bump PRs use the `version-bump/` branch prefix and are excluded from triggering another bump.

## Required GitHub setting

In **Settings → Actions → General → Workflow permissions**, enable read and write permissions for workflows, and allow GitHub Actions to create pull requests. If these permissions are disabled, the automated version PR cannot be opened.
