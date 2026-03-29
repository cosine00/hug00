import pandas as pd
import requests
import time
import os

def get_neodb_poster(target_url):
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
                return results[0].get('cover_url')
    except Exception as e:
        print(f"Error calling NeoDB for {target_url}: {e}")
    return None

def process_file(file_path):
    if not os.path.exists(file_path):
        print(f"Skip: {file_path} not found")
        return

    print(f"Processing: {file_path}")
    
    # 指定编码为 utf-8-sig 以兼容更多环境
    try:
        df = pd.read_csv(file_path, encoding='utf-8-sig')
    except:
        df = pd.read_csv(file_path)
    
    updated_count = 0
    for index, row in df.iterrows():
        db_url = row.get('url')
        current_poster = str(row.get('poster', ''))
        
        if db_url and ('dou.img.lithub.cc' in current_poster or not current_poster or 'nan' in current_poster.lower()):
            new_img = get_neodb_poster(db_url)
            if new_img:
                df.at[index, 'poster'] = new_img
                updated_count += 1
                print(f"  OK: {row.get('title', 'Unknown')}")
            time.sleep(0.5)

    # 尝试保存。如果直接写入失败，先删除原文件再写入
    try:
        df.to_csv(file_path, index=False, encoding='utf-8-sig')
    except PermissionError:
        os.remove(file_path)
        df.to_csv(file_path, index=False, encoding='utf-8-sig')
        
    print(f"Done! Updated {updated_count} links.\n")

if __name__ == "__main__":
    process_file('assets/data/douban/book.csv')
    process_file('assets/data/douban/movie.csv')