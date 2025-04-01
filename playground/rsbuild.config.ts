import { defineConfig } from '@rsbuild/core';
import { uploadImgCloudPlugin } from '../src';

export default defineConfig({
  plugins: [uploadImgCloudPlugin()],
});
