import pandas as pd
import requests
import time
import os

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
            print(f"🔍 正在解析: {title} ...", end="", flush=True)
            new_img = get_neodb_poster(db_url, title)
            
            if new_img:
                df.at[index, 'poster'] = new_img
                updated_count += 1
                print(" ✅ 替换成功")
            
            # 延时 1 秒，防止请求过快被断开连接
            time.sleep(1)

    temp_file = file_path + ".tmp"
    df.to_csv(temp_file, index=False, encoding='utf-8-sig')
    os.replace(temp_file, file_path)
    print(f"🎉 文件 {file_path} 处理完毕，本次成功替换了 {updated_count} 个链接。\n")

if __name__ == "__main__":
    process_file('assets/data/douban/book.csv')
    process_file('assets/data/douban/movie.csv')