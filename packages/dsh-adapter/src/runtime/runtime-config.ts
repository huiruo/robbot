export interface DshRuntimeConfig {
  submodule: string;
  protocol: 'acp';
  profile: string;
  buildRequired: boolean;
  /** Path to the ACP Cordis config, relative to the DSH runtime root. */
  configPath: string;
}

export const defaultDshRuntimeConfig: DshRuntimeConfig = {
  submodule: 'vendor/deepseek-harness',
  protocol: 'acp',
  profile: 'acp',
  buildRequired: true,
  configPath: 'examples/acp-agent/cordis.yml',
};
