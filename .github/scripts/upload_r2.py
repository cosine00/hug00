import os
import re
import requests
import boto3
import hashlib
from io import BytesIO
from PIL import Image
from datetime import datetime, timedelta

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
    """提取 Notion 图片 URL 的固定部分生成哈希值[cite: 2]"""
    stable_url = url.split('?')[0]
    return hashlib.md5(stable_url.encode('utf-8')).hexdigest()[:12]

def convert_to_beijing_time(match):
    """将 ISO 格式时间转换为北京时间 YYYY-MM-DD HH:MM:SS"""
    key = match.group(1)
    utc_str = match.group(2)
    try:
        # 解析 ISO 格式并转换为北京时间 (+8小时)
        dt = datetime.fromisoformat(utc_str.replace('Z', '+00:00'))
        bj_dt = dt + timedelta(hours=8)
        return f"{key}: {bj_dt.strftime('%Y-%m-%d %H:%M:%S')}"
    except Exception:
        return match.group(0)

def rename_markdown_file(filepath, content):
    """根据内容重命名文件为 YYYY-MM-DD title.md"""
    title_match = re.search(r'^title:\s*(.*)$', content, re.MULTILINE)
    date_match = re.search(r'^date:\s*([\d\-]+)', content, re.MULTILINE)
    
    if title_match and date_match:
        # 提取标题并清理非法字符
        title = title_match.group(1).strip().strip('"').strip("'")
        title = re.sub(r'[\\/:*?"<>|]', '', title) 
        date_str = date_match.group(1)
        
        new_filename = f"{date_str} {title}.md"
        new_filepath = os.path.join(os.path.dirname(filepath), new_filename)
        
        if filepath != new_filepath:
            if os.path.exists(new_filepath):
                os.remove(new_filepath)
            os.rename(filepath, new_filepath)
            print(f"  📝 已重命名文件: {new_filename}")

def process_markdown_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # --- 新增：时间格式转换 ---
    content = re.sub(r'(date|created|updated):\s*([\d\-T:\+\.]+)', convert_to_beijing_time, content)

    # --- 原有图片处理逻辑[cite: 2] ---
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

        # 匹配缓存[cite: 2]
        cache_match = re.search(f"{R2_DOMAIN}/notion/{img_hash}\\.[a-zA-Z0-9]+", old_content)
        if cache_match:
            expected_r2_url = cache_match.group(0)
            print(f"  ⚡ 缓存命中: {expected_r2_url}")
            content = content.replace(img_url, expected_r2_url)
            changed = True
            continue

        print(f"  ☁️ 处理新图片: {img_url[:50]}...")
        try:
            response = requests.get(img_url, timeout=15)
            if response.status_code == 200:
                ctype = response.headers.get('Content-Type', '')
                orig_ext = 'png'
                if 'jpeg' in ctype or 'jpg' in ctype: orig_ext = 'jpg'
                elif 'gif' in ctype: orig_ext = 'gif'
                elif 'webp' in ctype: orig_ext = 'webp'

                img = Image.open(BytesIO(response.content))
                
                if getattr(img, "is_animated", False):
                    final_bytes = response.content
                    final_ext = 'gif'
                    final_ctype = 'image/gif'
                else:
                    try:
                        # 纯净画布法处理 WebP[cite: 2]
                        if img.mode in ("RGBA", "P", "LA", "PA"):
                            img = img.convert("RGBA")
                            clean_img = Image.new("RGBA", img.size)
                        else:
                            img = img.convert("RGB")
                            clean_img = Image.new("RGB", img.size)
                        
                        clean_img.paste(img)
                        output_buffer = BytesIO()
                        clean_img.save(output_buffer, format="WEBP", quality=80, method=4)
                        
                        final_bytes = output_buffer.getvalue()
                        final_ext = 'webp'
                        final_ctype = 'image/webp'
                    except Exception as e_conv:
                        print(f"  ⚠️ WebP 失败，回退原格式: {e_conv}")
                        final_bytes = response.content
                        final_ext = orig_ext
                        final_ctype = ctype or 'image/png'

                filename = f"notion/{img_hash}.{final_ext}"
                expected_r2_url = f"{R2_DOMAIN}/{filename}"

                s3_client.put_object(
                    Bucket=R2_BUCKET_NAME,
                    Key=filename,
                    Body=final_bytes,
                    ContentType=final_ctype
                )
                
                content = content.replace(img_url, expected_r2_url)
                changed = True
            else:
                print(f"  ❌ 下载失败: {response.status_code}")
        except Exception as e:
            print(f"  ❌ 处理异常: {e}")

    # 保存修改后的内容（包含时间转换和图片链接转换）
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    # 执行重命名
    rename_markdown_file(filepath, content)

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
    print("🚀 开始同步处理：图片压缩 + 时间格式校正 + 文件重命名...")
    main()
    print("✨ 全部处理完毕！")