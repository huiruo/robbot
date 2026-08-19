export interface DshRuntimeConfig {
  submodule: string;
  protocol: 'acp';
  profile: string;
  buildRequired: boolean;
}

export const defaultDshRuntimeConfig: DshRuntimeConfig = {
  submodule: 'vendor/deepseek-harness',
  protocol: 'acp',
  profile: 'acp',
  buildRequired: true,
};
