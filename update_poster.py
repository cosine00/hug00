import pandas as pd
import requests
import time
import os

def get_neodb_poster(target_url):
    """
    通过 CSV 中的 url 字段（豆瓣链接）在 NeoDB 中匹配并获取封面
    """
    api_endpoint = "https://neodb.social/api/catalog/search"
    params = {'query': target_url, 'page': 1}
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    try:
        response = requests.get(api_endpoint, params=params, headers=headers, timeout=15)
        if response.status_code == 200:
            results = response.json().get('data', [])
            if results:
                # 获取匹配到的第一个条目的 cover_url
                cover_url = results[0].get('cover_url')
                if cover_url:
                    return cover_url
    except Exception as e:
        print(f"查询 NeoDB 出错 [{target_url}]: {e}")
    return None

def process_file(file_path):
    if not os.path.exists(file_path):
        print(f"跳过：找不到文件 {file_path}")
        return

    print(f"正在处理: {file_path}")
    df = pd.read_csv(file_path)
    
    updated_count = 0
    for index, row in df.iterrows():
        db_url = row.get('url') # 豆瓣原始链接字段
        current_poster = str(row.get('poster', ''))
        
        # 触发条件：如果是豆瓣防盗链地址或者是空，则尝试从 NeoDB 获取
        if db_url and ('dou.img.lithub.cc' in current_poster or not current_poster):
            new_img = get_neodb_poster(db_url)
            if new_img:
                df.at[index, 'poster'] = new_img
                updated_count += 1
                print(f"  已替换: {row.get('title', '未知')}")
            
            # 稍作停顿，尊重 API 限制
            time.sleep(0.5)

    df.to_csv(file_path, index=False)
    print(f"完成！共替换 {updated_count} 个链接。\n")

if __name__ == "__main__":
    # 路径已更新为 assets/ 目录
    process_file('assets/data/douban/book.csv')
    process_file('assets/data/douban/movie.csv')