import { CfnResource, Fn } from 'aws-cdk-lib';
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
 * AWS::BedrockAgentCore::Harness の CfnResource ラッパ。
 *
 * aws-cdk-lib に L1 が無い。@aws/agentcore-cdk は L2 を持つが alpha 版で、
 * harness.json を置くディレクトリを必須にするため依存しない。
 * プロパティ名は同パッケージの harness-cfn-mapping.js から写した（aws-facts.md 参照）。
 */
export class Harness extends Construct {
  readonly harnessArn: string;
  readonly harnessId: string;
  readonly harnessName: string;

  constructor(scope: Construct, id: string, props: HarnessProps) {
    super(scope, id);

    this.harnessName = toHarnessName(props.instance, props.slug);

    const resource = new CfnResource(this, 'Resource', {
      type: 'AWS::BedrockAgentCore::Harness',
      properties: {
        HarnessName: this.harnessName,
        ExecutionRoleArn: props.executionRoleArn,
        Model: { BedrockModelConfig: { ModelId: props.modelId, ApiFormat: 'converse_stream' } },
        // 文字列ではなく配列。Text は minLength: 1
        SystemPrompt: [{ Text: props.systemPrompt }],
        Tools: props.tools.map(toolToCfn),
        // 省略するとサービスが managed memory を勝手に用意する。無効を明示する
        Memory: { Disabled: {} },
        AuthorizerConfiguration: {
          CustomJWTAuthorizer: {
            DiscoveryUrl: props.discoveryUrl,
            AllowedClients: [props.allowedClientId],
            CustomClaims: [
              {
                InboundTokenClaimName: 'cognito:groups',
                InboundTokenClaimValueType: 'STRING_LIST',
                AuthorizingClaimMatchValue: {
                  ClaimMatchValue: { MatchValueString: props.slug },
                  // cognito:groups は配列。EQUALS は STRING 型専用
                  ClaimMatchOperator: 'CONTAINS',
                },
              },
            ],
          },
        },
        // Environment は出さない。VPC を使わないため
        // （NetworkConfiguration は createOnly で後から変えられない）
      },
    });

    this.harnessArn = resource.ref;
    this.harnessId = Fn.getAtt(resource.logicalId, 'HarnessId').toString();
  }
}

function toolToCfn(tool: HarnessToolSpec): Record<string, unknown> {
  if (tool.type === 'agentcore_code_interpreter') {
    // codeInterpreterArn は省略可。省略すると組み込みが使われる
    return { Type: tool.type, Name: tool.name, Config: { AgentCoreCodeInterpreter: {} } };
  }
  if (!tool.description || !tool.inputSchema) {
    throw new Error(
      `inline_function のツール "${tool.name}" には description と inputSchema が必要です。`,
    );
  }
  return {
    Type: tool.type,
    Name: tool.name,
    Config: { InlineFunction: { Description: tool.description, InputSchema: tool.inputSchema } },
  };
}
