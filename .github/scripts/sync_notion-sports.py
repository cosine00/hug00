from collections import defaultdict
from datetime import datetime
import json
import os
import requests

# 环境变量读取（复用已有的 NOTION_TOKEN/NOTION_SECRET，使用新的 NOTION_SPORT_DATABASE_ID）
NOTION_TOKEN = os.getenv("NOTION_TOKEN")
DATABASE_ID = os.getenv("NOTION_SPORT_DATABASE_ID")
JSON_FILE_PATH = "assets/act.json"  # 如果你的 json 放在子目录（如 data/act.json），请修改此处相对路径

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
}


def load_existing_json():
  """读取本地已有的 json 数据（防止历史 manual 数据丢失）"""
  if os.path.exists(JSON_FILE_PATH):
    try:
      with open(JSON_FILE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)
    except Exception as e:
      print(f"读取现有 JSON 失败: {e}")
  return []


def format_moving_time(minutes):
  """将分钟数转化为 H:MM:SS 格式"""
  try:
    total_seconds = int(float(minutes) * 60)
    hours = total_seconds // 3600
    mins = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    return f"{hours}:{mins:02d}:{secs:02d}"
  except (ValueError, TypeError):
    return "0:00:00"


def fetch_unsynced_pages():
  """获取 Notion 中『同步』复选框为 false 的记录"""
  url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"
  payload = {
      "filter": {"property": "同步", "checkbox": {"equals": False}},
      "sorts": [{"property": "日期", "direction": "ascending"}],
  }

  pages = []
  has_more = True
  start_cursor = None

  while has_more:
    if start_cursor:
      payload["start_cursor"] = start_cursor
    response = requests.post(url, json=payload, headers=HEADERS)
    data = response.json()

    if response.status_code != 200:
      raise Exception(f"Notion API 请求失败: {data}")

    pages.extend(data.get("results", []))
    has_more = data.get("has_more", False)
    start_cursor = data.get("next_cursor")

  return pages


def mark_page_as_synced(page_id):
  """将 Notion 页面上的『同步』复选框勾选上"""
  url = f"https://api.notion.com/v1/pages/{page_id}"
  payload = {"properties": {"同步": {"checkbox": True}}}
  response = requests.patch(url, json=payload, headers=HEADERS)
  if response.status_code != 200:
    print(f"更新 Notion 页面 {page_id} 状态失败: {response.text}")


def process_and_merge():
  existing_data = load_existing_json()
  unsynced_pages = fetch_unsynced_pages()

  if not unsynced_pages:
    print("没有发现需要同步的新数据。")
    return

  print(f"发现 {len(unsynced_pages)} 条待同步记录，正在处理...")

  # 统计已有数据中各个日期最大的自增编号 (例如 20260727001)
  date_counts = defaultdict(int)
  for item in existing_data:
    run_id = str(item.get("run_id", ""))
    if len(run_id) == 11:
      date_part = run_id[:8]
      seq_part = int(run_id[8:])
      if seq_part > date_counts[date_part]:
        date_counts[date_part] = seq_part

  # 按照 Notion 记录中的时间提取与解析
  new_items_by_date = defaultdict(list)

  for page in unsynced_pages:
    page_id = page["id"]
    props = page["properties"]

    # 1. 提取日期与时间 (start_date_local)
    date_prop = props.get("日期", {}).get("date")
    if not date_prop or not date_prop.get("start"):
      continue

    # Notion 传回格式解析，如 "2026-07-27T12:01:00.000+08:00" 或 "2026-07-27"
    start_iso = date_prop["start"]
    if "T" in start_iso:
      dt = datetime.fromisoformat(start_iso)
      start_date_local = dt.strftime("%Y-%m-%d %H:%M:%S")
      date_str = dt.strftime("%Y-%m-%d")
    else:
      start_date_local = f"{start_iso} 00:00:00"
      date_str = start_iso

    # 2. 运动名称
    title_list = props.get("运动名称", {}).get("title", [])
    name = title_list[0].get("plain_text", "") if title_list else ""

    # 3. 运动时长 (分钟数 -> H:MM:SS)
    duration_min = props.get("运动时长", {}).get("number", 0)
    moving_time = format_moving_time(duration_min)

    # 4. 平均心率
    average_heartrate = props.get("平均心率", {}).get("number", 0.0)
    if average_heartrate is not None:
      average_heartrate = round(float(average_heartrate), 1)

    # 5. 运动类型 (Select)
    type_select = props.get("运动类型", {}).get("select")
    activity_type = type_select.get("name", "") if type_select else ""

    # 6. 数据来源 (Select)
    source_select = props.get("来源", {}).get("select")
    source = (
        source_select.get("name", "Notion") if source_select else "Notion"
    )

    new_items_by_date[date_str].append({
        "page_id": page_id,
        "name": name,
        "moving_time": moving_time,
        "type": activity_type,
        "start_date_local": start_date_local,
        "summary_polyline": "",
        "average_heartrate": average_heartrate,
        "source": source,
    })

  new_entries = []
  processed_page_ids = []

  # 生成递增 run_id 并整理数据
  for date_str in sorted(new_items_by_date.keys()):
    day_records = new_items_by_date[date_str]
    # 同一天内按 start_date_local 升序排列
    day_records.sort(key=lambda x: x["start_date_local"])

    date_prefix = date_str.replace("-", "")

    for item in day_records:
      date_counts[date_prefix] += 1
      seq = date_counts[date_prefix]
      run_id = int(f"{date_prefix}{seq:03d}")

      new_entries.append({
          "run_id": run_id,
          "name": item["name"],
          "moving_time": item["moving_time"],
          "type": item["type"],
          "start_date_local": item["start_date_local"],
          "summary_polyline": item["summary_polyline"],
          "average_heartrate": item["average_heartrate"],
          "source": item["source"],
      })
      processed_page_ids.append(item["page_id"])

  # 合并旧数据与新数据，并按 start_date_local 重新升序排列
  final_json_data = existing_data + new_entries
  final_json_data.sort(key=lambda x: x.get("start_date_local", ""))

  # 保存写入 JSON
  with open(JSON_FILE_PATH, "w", encoding="utf-8") as f:
    json.dump(final_json_data, f, ensure_ascii=False, indent=2)

  print(f"成功将 {len(new_entries)} 条新数据追加并写入 {JSON_FILE_PATH}")

  # 回写 Notion 勾选复选框
  for pid in processed_page_ids:
    mark_page_as_synced(pid)

  print("Notion 状态更新完毕（已勾选『同步』）。")


if __name__ == "__main__":
  process_and_merge()