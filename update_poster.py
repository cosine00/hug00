import pandas as pd
import requests
import time
import os

def get_neodb_poster(target_url, title):
    api_endpoint = "https://neodb.social/api/catalog/search"
    params = {'query': target_url, 'page': 1}
    
    # 伪装得更像真实的浏览器，防止被 NeoDB 当成恶意爬虫拦截
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    }
    
    try:
        response = requests.get(api_endpoint, params=params, headers=headers, timeout=15)
        if response.status_code == 200:
            data = response.json()
            results = data.get('data', [])
            if results and len(results) > 0:
                cover = results[0].get('cover_url')
                if cover:
                    return cover
            else:
                print(f" [未找到] NeoDB 库中无匹配条目")
        else:
            # 这一步非常关键：如果被拦截，把 NeoDB 拒绝的原因打印出来
            print(f" [拦截] 状态码: {response.status_code}")
    except Exception as e:
        print(f" [网络异常] {e}")
    return None

def process_file(file_path):
    if not os.path.exists(file_path):
        print(f"❌ 找不到文件: {file_path}")
        return

    print(f"\n🚀 开始处理: {file_path}")
    # 强制以字符串读取，防止空值变成 NaN 干扰判断
    df = pd.read_csv(file_path, dtype=str)
    
    updated_count = 0
    for index, row in df.iterrows():
        title = str(row.get('title', '未知')).strip()
        db_url = str(row.get('url', '')).strip()
        current_poster = str(row.get('poster', '')).strip()
        
        # 只要有豆瓣链接，并且当前的图不是 neodb 的，就去替换
        if db_url and 'http' in db_url and 'neodb.social' not in current_poster:
            print(f"🔍 正在匹配: {title} ...", end="", flush=True)
            new_img = get_neodb_poster(db_url, title)
            
            if new_img:
                df.at[index, 'poster'] = new_img
                updated_count += 1
                print(f" ✅ 替换成功")
            
            # 延时 1 秒，对 GitHub Action IP 更友好，避免被封禁
            time.sleep(1)

    # 采用安全保存策略：先写临时文件再替换原文件，规避权限锁
    temp_file = file_path + ".tmp"
    df.to_csv(temp_file, index=False, encoding='utf-8-sig')
    os.replace(temp_file, file_path)
    print(f"🎉 文件 {file_path} 处理完毕，本次更新了 {updated_count} 个链接。\n")

if __name__ == "__main__":
    process_file('assets/data/douban/book.csv')
    process_file('assets/data/douban/movie.csv')