import pandas as pd
import requests
import time
import os

def get_neodb_poster(target_url, title):
    api_endpoint = "https://neodb.social/api/catalog/search"
    params = {'query': target_url, 'page': 1}
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json'
    }
    
    try:
        response = requests.get(api_endpoint, params=params, headers=headers, timeout=15)
        if response.status_code == 200:
            data = response.json()
            results = data.get('data', [])
            if results and len(results) > 0:
                # ！！！罪魁祸首已修复：NeoDB 的真正字段名是 cover_image_url ！！！
                cover = results[0].get('cover_image_url')
                if cover:
                    return cover
                print(" [缺图] 条目存在，但NeoDB上无封面")
                return None
            print(" [未找到] NeoDB 库中未收录此链接")
            return None
        print(f" [拦截] 状态码: {response.status_code}")
        return None
    except Exception as e:
        print(" [异常] 网络请求失败")
        return None

def process_file(file_path):
    if not os.path.exists(file_path):
        print(f"❌ 找不到文件: {file_path}")
        return

    print(f"\n🚀 开始处理: {file_path}")
    df = pd.read_csv(file_path, dtype=str)
    
    updated_count = 0
    for index, row in df.iterrows():
        title = str(row.get('title', '未知')).strip()
        db_url = str(row.get('url', '')).strip()
        current_poster = str(row.get('poster', '')).strip()
        
        if db_url and 'http' in db_url and 'neodb.social' not in current_poster:
            print(f"🔍 正在匹配: {title} ...", end="", flush=True)
            new_img = get_neodb_poster(db_url, title)
            
            if new_img:
                df.at[index, 'poster'] = new_img
                updated_count += 1
                print(" ✅ 替换成功")
            
            time.sleep(0.8)

    temp_file = file_path + ".tmp"
    df.to_csv(temp_file, index=False, encoding='utf-8-sig')
    os.replace(temp_file, file_path)
    print(f"🎉 文件 {file_path} 处理完毕，本次更新了 {updated_count} 个链接。\n")

if __name__ == "__main__":
    process_file('assets/data/douban/book.csv')
    process_file('assets/data/douban/movie.csv')