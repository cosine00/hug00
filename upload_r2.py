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

        # 因为我们要统一转为 webp，所以后缀固定为 .webp
        img_hash = get_stable_hash(img_url)
        filename = f"notion/{img_hash}.webp"
        expected_r2_url = f"{R2_DOMAIN}/{filename}"

        # 检查是否命中缓存（之前是否已经传过这张图）
        if expected_r2_url in old_content:
            print(f"  ⚡ 缓存命中，跳过处理: {expected_r2_url}")
            content = content.replace(img_url, expected_r2_url)
            changed = True
            continue

        print(f"  ☁️ 下载并处理新图片: {img_url[:50]}...")
        try:
            response = requests.get(img_url, timeout=15)
            if response.status_code == 200:
                # ==========================================
                # 核心处理区：格式转换与压缩
                # ==========================================
                # 1. 将下载的字节流读入 Image 对象
                img = Image.open(BytesIO(response.content))
                
                # 2. 如果图片是调色板模式(P)或带透明度的(RGBA)，为了兼容性确保转换为 RGBA
                if img.mode not in ("RGB", "RGBA"):
                    img = img.convert("RGBA")
                
                output_buffer = BytesIO()
                
                # 3. 检查是否是动态 GIF 图
                if getattr(img, "is_animated", False):
                    # 动态图转为动态 WebP，保留所有帧
                    img.save(output_buffer, format="WEBP", quality=80, save_all=True)
                else:
                    # 静态图转为 WebP，quality=80 压缩画质 (范围 1-100)
                    img.save(output_buffer, format="WEBP", quality=80, method=4)
                
                compressed_bytes = output_buffer.getvalue()
                # ==========================================

                print(f"  ⬆️ 上传 R2: {filename} (压缩后大小: {len(compressed_bytes)//1024} KB)")
                s3_client.put_object(
                    Bucket=R2_BUCKET_NAME,
                    Key=filename,
                    Body=compressed_bytes,
                    ContentType='image/webp'
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