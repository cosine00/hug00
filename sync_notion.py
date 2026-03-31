import os
import re
import requests
import boto3
import uuid
import yaml

# 1. 环境变量读取与终极修正
# 将 GitHub Secret 中的 NOTION_SECRET 提取出来，并强行注入为 NOTION_TOKEN
# 这是因为格式转换库 notion2md 在底层是个死脑筋，只认 NOTION_TOKEN 这个名字
NOTION_TOKEN = os.environ.get('NOTION_SECRET', '')
os.environ['NOTION_TOKEN'] = NOTION_TOKEN  

raw_db_id = os.environ.get('NOTION_DATABASE_ID', '')
# 自动清洗 ID
db_match = re.search(r'([a-fA-F0-9]{32})', raw_db_id.replace('-', ''))
NOTION_DATABASE_ID = db_match.group(1) if db_match else raw_db_id.strip()

R2_ACCESS_KEY = os.environ.get('R2_ACCESS_KEY_ID')
R2_SECRET_KEY = os.environ.get('R2_SECRET_ACCESS_KEY')
R2_ENDPOINT = os.environ.get('R2_ENDPOINT')
R2_BUCKET_NAME = os.environ.get('R2_BUCKET')
R2_DOMAIN = os.environ.get('R2_PUBLIC_DOMAIN')

# 输出目录配置
POSTS_DIR = 'content/posts/notion'
PAGES_DIR = 'content'

# 必须在环境变量注入后导入，否则它会报错找不到 Token
from notion2md.exporter.block import StringExporter

# 初始化 R2(S3) 客户端
s3_client = boto3.client(
    's3',
    endpoint_url=R2_ENDPOINT,
    aws_access_key_id=R2_ACCESS_KEY,
    aws_secret_access_key=R2_SECRET_KEY,
    region_name='auto'
)

def get_prop_value(prop):
    if not prop: return ""
    ptype = prop.get("type")
    if ptype == "title":
        return "".join([t["plain_text"] for t in prop.get("title", [])])
    elif ptype == "rich_text":
        return "".join([t["plain_text"] for t in prop.get("rich_text", [])])
    elif ptype == "select":
        return prop["select"]["name"] if prop.get("select") else ""
    elif ptype == "multi_select":
        return [t["name"] for t in prop.get("multi_select", [])]
    elif ptype == "date":
        return prop["date"]["start"] if prop.get("date") else ""
    elif ptype == "checkbox":
        return prop.get("checkbox", False)
    elif ptype == "status":
        return prop["status"]["name"] if prop.get("status") else ""
    return ""

def process_images_in_markdown(content):
    pattern = re.compile(r'!\[([^\]]*)\]\((https?://[^\)]+)\)')
    matches = pattern.findall(content)

    for alt_text, img_url in matches:
        if R2_DOMAIN in img_url:
            continue

        print(f"  正在下载图片...")
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
            else:
                print(f"  图片下载失败，状态码: {response.status_code}")
        except Exception as e:
            print(f"  处理图片异常: {e}")
            
    return content

def main():
    os.makedirs(POSTS_DIR, exist_ok=True)
    os.makedirs(PAGES_DIR, exist_ok=True)

    print(f"解析后的 Database ID: {NOTION_DATABASE_ID}")
    print("开始使用原生 requests 查询 Notion 数据库...")
    
    # ---------------------------------------------------------
    # 【终极修复区】：自己掌控命运，写死绝对正确的完整官方 URL！
    # ---------------------------------------------------------
    url = f"https://api.notion.com/v1/databases/{NOTION_DATABASE_ID}/query"
    headers = {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Notion-Version": "2022-06-28", # 锁死官方版本，防止它瞎更新
        "Content-Type": "application/json"
    }
    payload = {
        "filter": {
            "property": "pstatus",
            "select": { "equals": "已发布" }
        }
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        if response.status_code != 200:
            print(f"❌ 查询失败，HTTP 状态码: {response.status_code}")
            print(f"❌ 官方完整报错详情: {response.text}")
            return
        results = response.json().get("results", [])
    except Exception as e:
        print(f"❌ 网络请求异常: {e}")
        return

    print(f"找到 {len(results)} 篇已发布文章。")

    for page in results:
        props = page["properties"]
        
        title = get_prop_value(props.get("Name") or props.get("title"))
        slug = get_prop_value(props.get("slug"))
        ptype = get_prop_value(props.get("ptype")) or "post"
        
        if not slug:
            print(f"⚠️ 警告: 文章《{title}》缺少 slug，已跳过。")
            continue

        print(f"处理文章: {title} ({slug})")

        frontmatter = {
            "title": title,
            "date": get_prop_value(props.get("date")) or get_prop_value(props.get("created")),
            "lastmod": get_prop_value(props.get("updated")),
            "author": get_prop_value(props.get("author")),
            "tags": get_prop_value(props.get("tags")),
            "draft": get_prop_value(props.get("draft")),
            "slug": slug
        }
        
        frontmatter = {k: v for k, v in frontmatter.items() if v != "" and v != []}
        
        # 导出 markdown
        md_exporter = StringExporter(block_id=page["id"])
        md_content = md_exporter.export()
        
        md_content = process_images_in_markdown(md_content)

        yaml_frontmatter = yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False)
        final_content = f"---\n{yaml_frontmatter}---\n\n{md_content}"

        save_dir = PAGES_DIR if ptype == 'page' else POSTS_DIR
        filepath = os.path.join(save_dir, f"{slug}.md")

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(final_content)
        
        print(f"✅ 成功生成/更新: {filepath}")
        
    print("\n🎉 同步完成！")

if __name__ == '__main__':
    main()