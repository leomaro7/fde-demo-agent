import { App } from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack.js';
import { DemoStack } from '../lib/demo-stack.js';
import { demos } from '../../demos/index.js';

const app = new App();

// 同一アカウントに複数の土台を置けることを前提にする。省略は許さない。
const instance = app.node.tryGetContext('instance');
if (!instance) {
  throw new Error('instance が指定されていません。`cdk deploy -c instance=<name>` で渡してください。');
}

const env = { region: 'ap-northeast-1', account: process.env.CDK_DEFAULT_ACCOUNT };

const foundationStackName = `FdeDemo-${instance}-Foundation`;
const foundation = new FoundationStack(app, foundationStackName, { instance, env });

for (const { demo } of Object.values(demos)) {
  const demoStack = new DemoStack(app, `FdeDemo-${instance}-${demo.slug}`, {
    instance,
    foundationStackName,
    demo,
    env,
  });

  // demo-stack.ts は土台の値を Fn.importValue(foundationStackName + '-...') という
  // リテラル文字列で引いている。CDK はこの文字列から依存関係を推論できないため、
  // スタック間依存グラフに載らない（cdk.out/manifest.json の dependencies に
  // 土台が含まれない）。CloudFormation の Export 保護（使用中の Export は削除不可）
  // はデプロイ順序までは保証しないので、`cdk deploy --all --concurrency` のような
  // 並列実行では案件スタックが先に走り「まだ存在しない Export」を参照して失敗しうる。
  // そのため依存を明示的に宣言する。
  // （aws-cdk-lib 2.263.0 で addDependency は addStackDependency に改名され
  // 非推奨になっている。挙動は同じなので警告の出ない後者を使う）
  demoStack.addStackDependency(foundation);
}
