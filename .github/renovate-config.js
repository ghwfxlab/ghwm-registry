module.exports = {
  configValidationError: true,
  gitAuthor: 'GH Workflows Renovate Bot <renovate-gh-workflows@users.noreply.github.com>',
  platform: 'github',
  // `repositories` is provided at runtime via the RENOVATE_REPOSITORIES
  // environment variable set in .github/workflows/renovate.yml. The action
  // does not forward GITHUB_REPOSITORY into the Renovate container, so it
  // cannot be read here.
  onboarding: false,
  requireConfig: 'required',
};
