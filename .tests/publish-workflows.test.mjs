import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowRoot = new URL('../.github/workflows/', import.meta.url);
const cnWorkflow = readFileSync(
  new URL('publish-cindy-plugins.yml', workflowRoot),
  'utf8',
);
const globalWorkflow = readFileSync(
  new URL('publish-cindy-plugins-global.yml', workflowRoot),
  'utf8',
);

test('CN and Global plugin publishers are operationally independent', () => {
  assert.match(cnWorkflow, /^name: Publish Cindy Plugins \(CN\)$/m);
  assert.match(globalWorkflow, /^name: Publish Cindy Plugins \(Global\)$/m);
  assert.match(cnWorkflow, /group: cindy-plugin-publish-cn-prod-/);
  assert.match(globalWorkflow, /group: cindy-plugin-publish-global-prod-/);

  assert.match(cnWorkflow, /CINDY_PLUGIN_SERVER_URL_CN/);
  assert.doesNotMatch(cnWorkflow, /CINDY_PLUGIN_SERVER_URL_GLOBAL/);
  assert.match(globalWorkflow, /CINDY_PLUGIN_SERVER_URL_GLOBAL/);
  assert.doesNotMatch(globalWorkflow, /CINDY_PLUGIN_SERVER_URL_CN/);
});

test('both regional publishers support main pushes and full manual republish', () => {
  for (const workflow of [cnWorkflow, globalWorkflow]) {
    assert.match(workflow, /push:\n    branches:\n      - main/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /EVENT_NAME === 'workflow_dispatch'/);
    assert.match(workflow, /Publishing all Cindy plugins:/);
    assert.match(workflow, /id-token: write/);
    assert.match(workflow, /audience=cindy-plugin/);
  }
});

test('both regional publishers pin checkout before requesting OIDC', () => {
  const checkoutRef = '3d3c42e5aac5ba805825da76410c181273ba90b1';
  for (const workflow of [cnWorkflow, globalWorkflow]) {
    assert.match(workflow, new RegExp(`actions/checkout@${checkoutRef}`));
    assert.doesNotMatch(workflow, /actions\/checkout@v\d+/);
  }
});
