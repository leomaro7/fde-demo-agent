import { CfnHarness } from 'aws-cdk-lib/aws-bedrockagentcore';
import { Construct } from 'constructs';
import { toHarnessName } from './naming.js';

export interface HarnessToolSpec {
  readonly type: 'inline_function' | 'agentcore_code_interpreter';
  readonly name: string;
  /** inline_function のときだけ使う。 */
  readonly description?: string;
  /** inline_function のときだけ使う。 */
  readonly inputSchema?: Record<string, unknown>;
}

export interface HarnessProps {
  readonly instance: string;
  readonly slug: string;
  readonly executionRoleArn: string;
  readonly modelId: string;
  readonly systemPrompt: string;
  readonly tools: readonly HarnessToolSpec[];
  readonly discoveryUrl: string;
  readonly allowedClientId: string;
}

/**
 * AWS::BedrockAgentCore::Harness を作る。
 *
 * aws-cdk-lib の L1（CfnHarness）を使う。@aws/agentcore-cdk は L2 を持つが alpha 版で、
 * harness.json を置くディレクトリを必須にするため依存しない。
 *
 * 許容値の根拠は aws-facts.md にある。とくに inboundTokenClaimValueType は
 * STRING と STRING_ARRAY の 2 つだけで、STRING_LIST は存在しない。
 */
export class Harness extends Construct {
  readonly harnessArn: string;
  readonly harnessId: string;
  readonly harnessName: string;

  constructor(scope: Construct, id: string, props: HarnessProps) {
    super(scope, id);

    this.harnessName = toHarnessName(props.instance, props.slug);

    const resource = new CfnHarness(this, 'Resource', {
      harnessName: this.harnessName,
      executionRoleArn: props.executionRoleArn,
      model: { bedrockModelConfig: { modelId: props.modelId, apiFormat: 'converse_stream' } },
      // 文字列ではなく配列。text は minLength: 1
      systemPrompt: [{ text: props.systemPrompt }],
      tools: props.tools.map(toolToCfn),
      // 省略するとサービスが managed memory を勝手に用意する。無効を明示する
      memory: { disabled: {} },
      authorizerConfiguration: {
        customJwtAuthorizer: {
          discoveryUrl: props.discoveryUrl,
          allowedClients: [props.allowedClientId],
          customClaims: [
            {
              inboundTokenClaimName: 'cognito:groups',
              // 配列のうち少なくとも 1 つに一致するかを見る型
              inboundTokenClaimValueType: 'STRING_ARRAY',
              authorizingClaimMatchValue: {
                claimMatchValue: { matchValueString: props.slug },
                // cognito:groups は配列。EQUALS は STRING 型専用
                claimMatchOperator: 'CONTAINS',
              },
            },
          ],
        },
      },
      // environment は渡さない。VPC を使わないため
      // （networkConfiguration は createOnly で後から変えられない）
    });

    this.harnessArn = resource.attrArn;
    this.harnessId = resource.attrHarnessId;
  }
}

function toolToCfn(tool: HarnessToolSpec): CfnHarness.HarnessToolProperty {
  if (tool.type === 'agentcore_code_interpreter') {
    // codeInterpreterArn は省略可。省略すると組み込みが使われる
    return { type: tool.type, name: tool.name, config: { agentCoreCodeInterpreter: {} } };
  }
  if (!tool.description || !tool.inputSchema) {
    throw new Error(
      `inline_function のツール "${tool.name}" には description と inputSchema が必要です。`,
    );
  }
  return {
    type: tool.type,
    name: tool.name,
    config: { inlineFunction: { description: tool.description, inputSchema: tool.inputSchema } },
  };
}
