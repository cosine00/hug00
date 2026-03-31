import os
import re
import requests
import boto3
import uuid

# 从环境变量精准读取你的 Secrets
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

def process_markdown_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 匹配 Markdown 图片格式: ![alt](url)
    pattern = re.compile(r'!\[([^\]]*)\]\((https?://[^\)]+)\)')
    matches = pattern.findall(content)

    changed = False
    for alt_text, img_url in matches:
        if R2_DOMAIN in img_url:
            continue  # 已经是 R2 链接，说明是更新老文章，跳过

        print(f"  正在下载图片: {img_url[:50]}...")
        try:
            response = requests.get(img_url, timeout=15)
            if response.status_code == 200:
                ext = 'png'
                ctype = response.headers.get('Content-Type', '')
                if 'jpeg' in ctype or 'jpg' in ctype: ext = 'jpg'
                elif 'gif' in ctype: ext = 'gif'
                elif 'webp' in ctype: ext = 'webp'
                
                filename = f"notion/{uuid.uuid4().hex[:10]}.{ext}"
                print(f"  上传至 R2: {filename}")
                
                s3_client.put_object(
                    Bucket=R2_BUCKET_NAME,
                    Key=filename,
                    Body=response.content,
                    ContentType=ctype or 'image/png'
                )
                
                new_url = f"{R2_DOMAIN}/{filename}"
                content = content.replace(img_url, new_url)
                changed = True
            else:
                print(f"  图片下载失败，状态码: {response.status_code}")
        except Exception as e:
            print(f"  处理图片异常: {e}")

    # 如果有图片被替换，才重新写入文件
    if changed:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"✅ 完成图片替换: {filepath}")

def main():
    # 扫描 Action 生成的目录
    dirs_to_scan = ['content/posts/notion', 'content']
    for d in dirs_to_scan:
        if not os.path.exists(d):
            continue
        for root, _, files in os.walk(d):
            for file in files:
                if file.endswith('.md'):
                    process_markdown_file(os.path.join(root, file))

if __name__ == '__main__':
    print("开始扫描 Markdown 并上传图片至 R2...")
    main()
    print("图片处理完毕！")