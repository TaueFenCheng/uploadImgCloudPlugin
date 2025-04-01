import type { RsbuildPlugin } from '@rsbuild/core';

export type uploadImgCloudPluginType = {
  foo?: string;
  bar?: boolean;
};

export const uploadImgCloudPlugin = (
  options: uploadImgCloudPluginType = {},
): RsbuildPlugin => ({
  name: 'uploadImgCloudPlugin',
  setup(api) {
    const config = api.getRsbuildConfig();
    console.log(config.html?.title);
    console.log('Hello Rsbuild!', options);
  },
});
