import os
import re
import requests
import boto3
import hashlib

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
    """提取 Notion 图片 URL 的固定部分（去除会变的签名参数），生成固定哈希值"""
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

        # 1. 生成基于图片的固定文件名
        ext = img_url.split('?')[0].split('.')[-1].lower()
        if ext not in ['png', 'jpg', 'jpeg', 'gif', 'webp']:
            ext = 'png'
            
        img_hash = get_stable_hash(img_url)
        filename = f"notion/{img_hash}.{ext}"
        expected_r2_url = f"{R2_DOMAIN}/{filename}"

        # 2. 【核心优化】：如果正式目录的旧文章里已经有这个 R2 链接，说明传过了，直接秒替换！
        if expected_r2_url in old_content:
            print(f"  ⚡ 图片已在 R2 (命中缓存)，跳过下载与上传: {expected_r2_url}")
            content = content.replace(img_url, expected_r2_url)
            changed = True
            continue

        # 3. 如果没命中缓存，说明是新图，正常下载上传
        print(f"  ☁️ 正在下载新图片: {img_url[:50]}...")
        try:
            response = requests.get(img_url, timeout=15)
            if response.status_code == 200:
                ctype = response.headers.get('Content-Type', '')
                if 'jpeg' in ctype or 'jpg' in ctype: ext = 'jpg'
                elif 'gif' in ctype: ext = 'gif'
                elif 'webp' in ctype: ext = 'webp'
                
                filename = f"notion/{img_hash}.{ext}"
                expected_r2_url = f"{R2_DOMAIN}/{filename}"

                print(f"  ⬆️ 上传至 R2: {filename}")
                s3_client.put_object(
                    Bucket=R2_BUCKET_NAME,
                    Key=filename,
                    Body=response.content,
                    ContentType=ctype or 'image/png'
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
    # 【核心优化】：只扫描刚刚由 Action 生成的临时文件夹，绝不触碰你的老文件！
    dirs_to_scan = ['temp_content']
    for d in dirs_to_scan:
        if not os.path.exists(d):
            continue
        for root, _, files in os.walk(d):
            for file in files:
                if file.endswith('.md'):
                    process_markdown_file(os.path.join(root, file))

if __name__ == '__main__':
    print("开始扫描临时文件夹中的 Markdown 图片...")
    main()
    print("图片处理完毕！")