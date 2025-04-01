import crypto from 'node:crypto';
import path from 'node:path';
import type { RsbuildPlugin, TransformContext } from '@rsbuild/core';
import COS from 'cos-nodejs-sdk-v5';

export type uploadImgCloudPluginType = {
  /**
   * 腾讯云COS配置
   */
  cos?: {
    SecretId: string;
    SecretKey: string;
    Bucket: string;
    Region: string;
  };
  /**
   * 阿里云OSS配置（预留，暂未实现）
   */
  oss?: {
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
    region: string;
  };
  /**
   * CDN基础URL，用于替换图片地址
   * 例如：https://your-cdn-domain.com/
   */
  cdnBaseUrl?: string;
  /**
   * 是否在开发环境中也上传图片
   * @default false
   */
  uploadInDev?: boolean;
  /**
   * 自定义路径前缀，会添加到上传的文件路径前
   * 例如：'assets/images/'
   * @default 'images/'
   */
  pathPrefix?: string;
  /**
   * 是否保留原始文件名
   * @default true
   */
  keepFilename?: boolean;
  /**
   * 是否在控制台输出详细日志
   * @default true
   */
  verbose?: boolean;
};

export const uploadImgCloudPlugin = (
  options: uploadImgCloudPluginType = {},
): RsbuildPlugin => ({
  name: 'uploadImgCloudPlugin',
  setup(api) {
    const verbose = options.verbose !== false;
    // const config = api.getRsbuildConfig();
    const isDev = process.env.NODE_ENV === 'development';
    // 图片路径映射，用于存储本地路径到CDN URL的映射
    const imageUrlMap = new Map<string, string>();

    // 处理图片资源
    api.transform(
      { test: /\.(png|jpe?g|gif|svg|webp)$/ },
      (info: TransformContext) => {
        // 记录原始路径，用于后续替换
        const originalPath = info.resourcePath;
        // 将原始路径添加到映射中，初始值为空字符串，后续会在processAssets阶段更新为CDN URL
        imageUrlMap.set(originalPath, '');
        if (options.verbose !== false) {
          console.log(`[uploadImgCloudPlugin] 记录图片路径: ${originalPath}`);
        }
        return info;
      },
    );

    // 初始化COS客户端
    let cosClient: COS | null = null;
    if (options.cos) {
      cosClient = new COS({
        SecretId: options.cos.SecretId,
        SecretKey: options.cos.SecretKey,
      });
    }

    // 如果没有配置CDN或者是开发环境且不需要上传，则跳过上传逻辑
    const shouldSkipUpload =
      (!options.cos && !options.oss) || (isDev && !options.uploadInDev);
    if (shouldSkipUpload) {
      console.warn(
        '[uploadImgCloudPlugin] 未配置云存储信息或开发环境不需要上传，跳过图片上传',
      );
      // 即使跳过上传，我们仍然需要处理图片资源，以便在开发环境中正常显示
    }
    // 在构建完成后处理资源并上传到CDN
    api.processAssets(
      { stage: 'additional', environments: ['web'] },
      async ({ assets, sources, compilation }) => {
        // 如果跳过上传或没有配置COS客户端，则直接返回
        if (shouldSkipUpload || !cosClient || !options.cos) {
          return;
        }

        // 获取配置选项，设置默认值
        const pathPrefix = options.pathPrefix || 'images/';
        const keepFilename = options.keepFilename !== false;

        // 使用transform阶段收集的图片路径映射，而不是创建新的映射
        // 遍历所有资源
        for (const [filename, asset] of Object.entries(assets)) {
          // 检查是否为图片资源
          if (/\.(png|jpe?g|gif|svg|webp)$/.test(filename)) {
            try {
              // 获取资源内容
              const content = asset.source();
              console.log('content\n', content);
              // return
              if (!content) continue;

              // 生成在COS上的路径
              let cosPath;
              if (keepFilename) {
                cosPath = `${pathPrefix}${path.basename(filename)}`;
              } else {
                // 使用哈希名称避免文件名冲突
                // 使用文件内容生成哈希，确保相同内容的文件生成相同的哈希
                const hash = crypto
                  .createHash('md5')
                  .update(content)
                  .digest('hex')
                  .substring(0, 8);
                const ext = path.extname(filename);
                cosPath = `${pathPrefix}${hash}${ext}`;
              }

              // 上传到COS
              await new Promise<void>((resolve, reject) => {
                cosClient!.putObject(
                  {
                    Bucket: options.cos!.Bucket,
                    Region: options.cos!.Region,
                    Key: cosPath,
                    Body: content,
                  },
                  (err, data) => {
                    if (err) {
                      console.error(
                        `[uploadImgCloudPlugin] 上传图片失败: ${filename}`,
                        err,
                      );
                      reject(err);
                    } else {
                      if (verbose) {
                        console.log(
                          `[uploadImgCloudPlugin] 图片上传成功: ${filename}`,
                        );
                      }
                      resolve();
                    }
                  },
                );
              });

              // 构建CDN URL
              const cdnUrl = options.cdnBaseUrl
                ? `${options.cdnBaseUrl.replace(/\/$/, '')}/${cosPath}`
                : `https://${options.cos.Bucket}.cos.${options.cos.Region}.myqcloud.com/${cosPath}`;

              if (verbose) {
                console.log(
                  `[uploadImgCloudPlugin] 图片URL替换: ${filename} -> ${cdnUrl}`,
                );
              }

              // 记录资源URL映射，用于后续替换
              // 尝试查找transform阶段收集的原始路径
              let found = false;

              // 遍历imageUrlMap查找匹配的路径
              for (const [originalPath, _] of imageUrlMap.entries()) {
                // 检查原始路径是否包含当前文件名，或者文件名是否包含原始路径的一部分
                if (
                  originalPath.includes(path.basename(filename)) ||
                  filename.includes(path.basename(originalPath))
                ) {
                  // 找到匹配的路径，更新CDN URL
                  imageUrlMap.set(originalPath, cdnUrl);
                  if (verbose) {
                    console.log(
                      `[uploadImgCloudPlugin] 匹配到transform阶段路径: ${originalPath} -> ${cdnUrl}`,
                    );
                  }
                  found = true;
                  break;
                }
              }

              // 如果没有找到匹配的路径，也添加到映射中
              if (!found) {
                imageUrlMap.set(filename, cdnUrl);
                if (verbose) {
                  console.log(
                    `[uploadImgCloudPlugin] 未找到匹配路径，添加新映射: ${filename} -> ${cdnUrl}`,
                  );
                }
              }
            } catch (error) {
              console.error(
                `[uploadImgCloudPlugin] 上传图片失败: ${filename}`,
                error,
              );
            }
          }
        }

        // 替换JS文件中的图片引用
        for (const [filename, asset] of Object.entries(assets)) {
          if (/\.(j|t)s(x)$/.test(filename) && asset.source()) {
            let content = asset.source().toString();
            let hasChanges = false;

            // 替换所有已上传图片的URL
            for (const [imgPath, cdnUrl] of imageUrlMap.entries()) {
              // 只处理有CDN URL的图片（成功上传的图片）
              if (cdnUrl) {
                // 提取图片文件名，用于匹配
                const imgFileName = path.basename(imgPath);

                if (verbose) {
                  console.log(
                    `[uploadImgCloudPlugin] 替换JS文件中的图片引用: ${imgFileName} -> ${cdnUrl}`,
                  );
                }

                // 使用正则表达式查找并替换图片引用
                // 这里假设图片引用可能是相对路径或绝对路径
                const regex = new RegExp(`["']([^"']*${imgFileName})["']`, 'g');
                const newContent = content.replace(regex, `"${cdnUrl}"`);

                // 检查内容是否有变化
                if (newContent !== content) {
                  content = newContent;
                  hasChanges = true;
                }
              }
            }

            const source = new sources.RawSource(content);
            // 只有当内容有变化时才更新资源
            if (hasChanges) {
              // 使用compilation.updateAsset方法更新资源
              compilation.updateAsset(filename, source);

              if (verbose) {
                console.log(`[uploadImgCloudPlugin] 已更新JS文件: ${filename}`);
              }
            }
          }
        }
      },
    );

    // 添加构建完成的日志
    api.onAfterBuild(() => {
      if (!shouldSkipUpload) {
        if (verbose) {
          console.log(
            '[uploadImgCloudPlugin] 构建完成，静态图片已上传至CDN并替换URL',
          );
        }
      } else if (verbose) {
        console.log(
          '[uploadImgCloudPlugin] 构建完成，但由于配置原因跳过了图片上传',
        );
      }
    });
  },
});
