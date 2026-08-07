import pandas as pd
import requests
import time
import os
import json
import sys

CACHE_FILE = '.github/cache/douban-poster-cache.json'
DATA_FILES = [
    'assets/data/douban/book.csv',
    'assets/data/douban/movie.csv',
]


def clean_value(value):
    if pd.isna(value):
        return ''
    return str(value).strip()


def load_cache():
    if not os.path.exists(CACHE_FILE):
        return {}
    try:
        with open(CACHE_FILE, 'r', encoding='utf-8') as cache_file:
            data = json.load(cache_file)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError) as error:
        print(f'⚠️ 海报缓存读取失败，将重新建立：{error}')
        return {}


def save_cache(cache):
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    temp_file = CACHE_FILE + '.tmp'
    with open(temp_file, 'w', encoding='utf-8') as cache_file:
        json.dump(cache, cache_file, ensure_ascii=False, indent=2, sort_keys=True)
        cache_file.write('\n')
    os.replace(temp_file, CACHE_FILE)


def seed_cache_from_existing_files():
    cache = load_cache()
    added = 0
    for file_path in DATA_FILES:
        if not os.path.exists(file_path):
            continue
        df = pd.read_csv(file_path, dtype=str)
        for _, row in df.iterrows():
            db_url = clean_value(row.get('url', ''))
            current_poster = clean_value(row.get('poster', ''))
            if db_url and current_poster.startswith('https://neodb.social/') and cache.get(db_url) != current_poster:
                cache[db_url] = current_poster
                added += 1
    save_cache(cache)
    print(f'🗂️ NeoDB 海报缓存已就绪：共 {len(cache)} 条，本次新增或更新 {added} 条。')

def get_neodb_poster(target_url, title):
    # 【核心修复】：放弃 search 接口，改用专门解析外部链接的 fetch 接口
    api_endpoint = "https://neodb.social/api/catalog/fetch"
    
    # 这里的参数名是 url，而不是 query
    params = {'url': target_url}
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    }
    
    try:
        response = requests.get(api_endpoint, params=params, headers=headers, timeout=15)
        if response.status_code == 200:
            data = response.json()
            # fetch 接口直接返回书籍/电影完整对象，图片就在最外层
            cover = data.get('cover_image_url')
            if cover:
                return cover
            print(" [缺图] 获取成功，但该条目在NeoDB确实无封面")
            return None
        elif response.status_code == 404:
            print(" [未收录] NeoDB 的库中还没有这条记录")
            return None
        else:
            print(f" [拦截] 状态码: {response.status_code}")
            return None
    except Exception as e:
        print(" [异常] 网络请求失败")
        return None

def process_file(file_path, cache):
    if not os.path.exists(file_path):
        print(f"❌ 找不到文件: {file_path}")
        return

    print(f"\n🚀 开始处理: {file_path}")
    df = pd.read_csv(file_path, dtype=str)
    
    cache_hit_count = 0
    fetched_count = 0
    for index, row in df.iterrows():
        title = clean_value(row.get('title', '未知')) or '未知'
        db_url = clean_value(row.get('url', ''))
        current_poster = clean_value(row.get('poster', ''))

        if not db_url or 'http' not in db_url:
            continue

        if current_poster.startswith('https://neodb.social/'):
            cache[db_url] = current_poster
            continue

        cached_poster = cache.get(db_url)
        if cached_poster:
            df.at[index, 'poster'] = cached_poster
            cache_hit_count += 1
            continue

        if 'neodb.social' not in current_poster:
            print(f"🔍 正在解析: {title} ...", end="", flush=True)
            new_img = get_neodb_poster(db_url, title)
            
            if new_img:
                df.at[index, 'poster'] = new_img
                cache[db_url] = new_img
                fetched_count += 1
                print(" ✅ 替换成功")
            
            # 延时 1 秒，防止请求过快被断开连接
            time.sleep(1)

    temp_file = file_path + ".tmp"
    df.to_csv(temp_file, index=False, encoding='utf-8-sig')
    os.replace(temp_file, file_path)
    print(f"🎉 文件 {file_path} 处理完毕：缓存命中 {cache_hit_count} 条，新解析 {fetched_count} 条。\n")

if __name__ == "__main__":
    if '--seed-cache' in sys.argv:
        seed_cache_from_existing_files()
    else:
        poster_cache = load_cache()
        for data_file in DATA_FILES:
            process_file(data_file, poster_cache)
        save_cache(poster_cache)
        print(f'💾 NeoDB 海报缓存已保存：{len(poster_cache)} 条。')
