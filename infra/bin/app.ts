import { App } from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack.js';
import { DemoStack } from '../lib/demo-stack.js';
import { demo as smoke } from '../../demos/smoke/demo.js';

const app = new App();

// 同一アカウントに複数の土台を置けることを前提にする。省略は許さない。
const instance = app.node.tryGetContext('instance');
if (!instance) {
  throw new Error('instance が指定されていません。`cdk deploy -c instance=<name>` で渡してください。');
}

const env = { region: 'ap-northeast-1', account: process.env.CDK_DEFAULT_ACCOUNT };

const foundationStackName = `FdeDemo-${instance}-Foundation`;
new FoundationStack(app, foundationStackName, { instance, env });

for (const demo of [smoke]) {
  new DemoStack(app, `FdeDemo-${instance}-${demo.slug}`, {
    instance,
    foundationStackName,
    demo,
    env,
  });
}
