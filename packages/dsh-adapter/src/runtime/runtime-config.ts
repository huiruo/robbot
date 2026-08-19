export interface DshRuntimeConfig {
  submodule: string;
  protocol: 'sdk' | 'acp';
  profile: string;
  buildRequired: boolean;
  provider?: string;
  model?: string;
  /** Path to the Cordis config, relative to the DSH runtime root. */
  configPath: string;
}

export const defaultDshRuntimeConfig: DshRuntimeConfig = {
  submodule: 'vendor/deepseek-harness',
  protocol: 'sdk',
  profile: 'sdk',
  buildRequired: true,
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  configPath: '../../config/dsh-sdk-flash.cordis.yml',
};
