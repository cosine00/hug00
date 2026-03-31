import os
import re
import requests
import boto3
import hashlib
from io import BytesIO
from PIL import Image

# 从环境变量精准读取 Secrets
R2_ACCESS_KEY = os.environ.get('R2_ACCESS_KEY_ID')
R2_SECRET_KEY = os.environ.get('R2_SECRET_ACCESS_KEY')
R2_ENDPOINT = os.environ.get('R2_ENDPOINT')
R2_BUCKET_NAME = os.environ.get('R2_BUCKET')
R2_DOMAIN = os.environ.get('R2_PUBLIC_DOMAIN')

# 初始化 S3 客户端
s3_client = boto3.client(
    's3',
    endpoint_url=R2_ENDPOINT,
    aws_access_key_id=R2_ACCESS_KEY,
    aws_secret_access_key=R2_SECRET_KEY,
    region_name='auto'
)

def get_stable_hash(url):
    """提取 Notion 图片 URL 的固定部分生成哈希值"""
    stable_url = url.split('?')[0]
    return hashlib.md5(stable_url.encode('utf-8')).hexdigest()[:12]

def process_markdown_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 读取正式目录下的旧文件（如果存在），用来做缓存比对
    old_filepath = filepath.replace('temp_content', 'content', 1)
    old_content = ""
    if os.path.exists(old_filepath):
        with open(old_filepath, 'r', encoding='utf-8') as f:
            old_content = f.read()

    pattern = re.compile(r'!\[([^\]]*)\]\((https?://[^\)]+)\)')
    matches = pattern.findall(content)

    changed = False
    for alt_text, img_url in matches:
        if R2_DOMAIN in img_url:
            continue  

        img_hash = get_stable_hash(img_url)

        # 匹配可能存在的任何后缀的缓存
        cache_match = re.search(f"{R2_DOMAIN}/notion/{img_hash}\\.[a-zA-Z0-9]+", old_content)
        if cache_match:
            expected_r2_url = cache_match.group(0)
            print(f"  ⚡ 缓存命中，跳过处理: {expected_r2_url}")
            content = content.replace(img_url, expected_r2_url)
            changed = True
            continue

        print(f"  ☁️ 下载并处理新图片: {img_url[:50]}...")
        try:
            response = requests.get(img_url, timeout=15)
            if response.status_code == 200:
                # 获取原图的 Content-Type 以备回退使用
                ctype = response.headers.get('Content-Type', '')
                orig_ext = 'png'
                if 'jpeg' in ctype or 'jpg' in ctype: orig_ext = 'jpg'
                elif 'gif' in ctype: orig_ext = 'gif'
                elif 'webp' in ctype: orig_ext = 'webp'

                # 尝试打开图片
                img = Image.open(BytesIO(response.content))
                
                # 如果真的是动图 GIF，直接放行
                if getattr(img, "is_animated", False):
                    print(f"  🎞️ 检测到动图，跳过 WebP 转换，保留原格式...")
                    final_bytes = response.content
                    final_ext = 'gif'
                    final_ctype = 'image/gif'
                else:
                    try:
                        # ====================================================
                        # 【核心修复】：纯净画布法 (消除 Invalid frame dimensions)
                        # ====================================================
                        # 1. 强制统一颜色模式
                        if img.mode in ("RGBA", "P", "LA", "PA"):
                            img = img.convert("RGBA")
                            # 2. 创建一个大小完全相同的纯净透明画布
                            clean_img = Image.new("RGBA", img.size)
                        else:
                            img = img.convert("RGB")
                            # 2. 创建一个大小完全相同的纯净不透明画布
                            clean_img = Image.new("RGB", img.size)
                        
                        # 3. 把原图的像素“粘贴”到干净画布上，彻底丢弃原图的 offset 和 metadata
                        clean_img.paste(img)
                        
                        # 4. 用干净的画布进行 WebP 压缩
                        output_buffer = BytesIO()
                        clean_img.save(output_buffer, format="WEBP", quality=80, method=4)
                        
                        final_bytes = output_buffer.getvalue()
                        final_ext = 'webp'
                        final_ctype = 'image/webp'
                        # ====================================================

                    except Exception as e_conv:
                        # 【安全网】：就算天塌下来，也能把原图传上去，保证不断更
                        print(f"  ⚠️ WebP 压缩失败 ({e_conv})，安全回退到原图格式...")
                        final_bytes = response.content
                        final_ext = orig_ext
                        final_ctype = ctype or 'image/png'

                filename = f"notion/{img_hash}.{final_ext}"
                expected_r2_url = f"{R2_DOMAIN}/{filename}"

                print(f"  ⬆️ 上传 R2: {filename} (处理后大小: {len(final_bytes)//1024} KB)")
                s3_client.put_object(
                    Bucket=R2_BUCKET_NAME,
                    Key=filename,
                    Body=final_bytes,
                    ContentType=final_ctype
                )
                
                content = content.replace(img_url, expected_r2_url)
                changed = True
            else:
                print(f"  ❌ 图片下载失败，状态码: {response.status_code}")
        except Exception as e:
            print(f"  ❌ 处理图片异常: {e}")

    if changed:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"✅ 处理完成: {filepath}")

def main():
    dirs_to_scan = ['temp_content']
    for d in dirs_to_scan:
        if not os.path.exists(d):
            continue
        for root, _, files in os.walk(d):
            for file in files:
                if file.endswith('.md'):
                    process_markdown_file(os.path.join(root, file))

if __name__ == '__main__':
    print("开始扫描并进行 WebP 压缩处理...")
    main()
    print("图片压缩与上传完毕！")