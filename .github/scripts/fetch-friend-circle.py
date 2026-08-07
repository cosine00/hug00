#!/usr/bin/env python3
"""Build a Friend-Circle-Lite compatible feed from static/friends.json."""

from __future__ import annotations

import html
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FRIENDS_PATH = ROOT / "static" / "friends.json"
OUTPUT_PATH = ROOT / "assets" / "rss.json"
MAX_ARTICLES_PER_SITE = 20
MAX_TOTAL_ARTICLES = 600
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
REQUEST_TIMEOUT = 12
USER_AGENT = "HuxFriendCircle/1.0 (+https://hux.ink/)"

FEED_SUFFIXES = (
    "/index.xml",
    "/feed",
    "/feed/",
    "/atom.xml",
    "/feed.xml",
    "/rss.xml",
    "/rss",
    "/blog/feed/rss/",
    "/blog/feed/",
    "/feeds/posts/default",
)


class FeedLinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "link":
            return
        values = {key.lower(): value or "" for key, value in attrs}
        rel = values.get("rel", "").lower()
        media_type = values.get("type", "").lower()
        href = values.get("href", "").strip()
        if href and "alternate" in rel and ("rss" in media_type or "atom" in media_type or "xml" in media_type):
            self.links.append(href)


def fetch_bytes(url: str) -> tuple[bytes, str, str]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5"},
    )
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
        content = response.read(MAX_RESPONSE_BYTES + 1)
        if len(content) > MAX_RESPONSE_BYTES:
            raise ValueError("response is larger than 4 MiB")
        return content, response.geturl(), response.headers.get("Content-Type", "")


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def child_text(element: ET.Element, *names: str) -> str:
    wanted = {name.lower() for name in names}
    for child in list(element):
        if local_name(child.tag) in wanted:
            return "".join(child.itertext()).strip()
    return ""


def clean_text(value: str, limit: int = 220) -> str:
    value = re.sub(r"<(script|style)\b[^>]*>[\s\S]*?</\1>", " ", value or "", flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", html.unescape(value)).strip()
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def parse_datetime(value: str) -> datetime:
    raw = (value or "").strip()
    if not raw:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    try:
        parsed = parsedate_to_datetime(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        pass
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)


def atom_link(entry: ET.Element, base_url: str) -> str:
    fallback = ""
    for child in list(entry):
        if local_name(child.tag) != "link":
            continue
        href = child.attrib.get("href", "").strip()
        if not href:
            continue
        fallback = fallback or href
        if child.attrib.get("rel", "alternate") == "alternate":
            return urllib.parse.urljoin(base_url, href)
    return urllib.parse.urljoin(base_url, fallback) if fallback else ""


def parse_feed(content: bytes, feed_url: str, friend: list[str]) -> list[dict]:
    # Some WordPress feeds emit wfw:commentRss without declaring the wfw
    # namespace. It is irrelevant to article data and otherwise invalidates
    # the complete XML document for strict parsers.
    content = re.sub(
        rb"<wfw:commentRss\b[^>]*>.*?</wfw:commentRss\s*>",
        b"",
        content,
        flags=re.IGNORECASE | re.DOTALL,
    )
    root = ET.fromstring(content)
    root_name = local_name(root.tag)
    entries = [node for node in root.iter() if local_name(node.tag) == ("entry" if root_name == "feed" else "item")]
    articles: list[dict] = []

    for entry in entries[:MAX_ARTICLES_PER_SITE]:
        title = clean_text(child_text(entry, "title"), 180)
        if root_name == "feed":
            link = atom_link(entry, feed_url)
            published_raw = child_text(entry, "published", "updated")
            updated_raw = child_text(entry, "updated", "published")
            summary = child_text(entry, "summary", "content")
        else:
            link = child_text(entry, "link") or child_text(entry, "guid")
            link = urllib.parse.urljoin(feed_url, link.strip()) if link else ""
            published_raw = child_text(entry, "pubdate", "published", "date", "updated")
            updated_raw = child_text(entry, "updated", "modified", "pubdate", "date")
            summary = child_text(entry, "description", "encoded", "summary", "content")

        if not title or not link:
            continue
        published = parse_datetime(published_raw)
        updated = parse_datetime(updated_raw or published_raw)
        articles.append(
            {
                "title": title,
                "author": friend[0],
                "avatar": friend[2] if len(friend) > 2 else "",
                "link": link,
                "created": published.strftime("%Y-%m-%d %H:%M:%S"),
                "updated": updated.strftime("%Y-%m-%d %H:%M:%S"),
                "excerpt": clean_text(summary),
                "site_url": friend[1],
                "feed_url": feed_url,
                "_timestamp": published.timestamp(),
            }
        )
    return articles


def discover_feed_urls(site_url: str) -> list[str]:
    discovered: list[str] = []
    try:
        content, final_url, content_type = fetch_bytes(site_url)
        if "html" in content_type.lower() or b"<html" in content[:1000].lower():
            parser = FeedLinkParser()
            parser.feed(content.decode("utf-8", errors="replace"))
            discovered.extend(urllib.parse.urljoin(final_url, href) for href in parser.links)
    except Exception:
        pass

    clean_url = site_url.rstrip("/")
    discovered.extend(clean_url + suffix for suffix in FEED_SUFFIXES)
    return [url for url in dict.fromkeys(discovered) if not is_comment_feed(url)]


def is_comment_feed(url: str) -> bool:
    path = urllib.parse.urlparse(url).path.lower().rstrip("/")
    return bool(re.search(r"(?:^|/)(?:comments?|comment-feed)(?:/|$)", path))


def fetch_friend(friend: list[str]) -> tuple[list[dict], str, str]:
    name = friend[0] if friend else "未命名博客"
    site_url = friend[1].strip() if len(friend) > 1 else ""
    if not site_url:
        return [], "", "missing site URL"

    explicit_feed = friend[3].strip() if len(friend) > 3 and friend[3] else ""
    candidates = ([explicit_feed] if explicit_feed else []) + discover_feed_urls(site_url)
    candidates = list(dict.fromkeys(url for url in candidates if url and not is_comment_feed(url)))
    last_error = "no feed candidates"

    for feed_url in candidates:
        try:
            content, final_url, _ = fetch_bytes(feed_url)
            if is_comment_feed(final_url):
                last_error = f"comment feed ignored: {final_url}"
                continue
            articles = parse_feed(content, final_url, friend)
            if articles:
                return articles, final_url, ""
            last_error = f"empty feed: {feed_url}"
        except (ET.ParseError, urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            last_error = f"{feed_url}: {exc}"
    return [], "", f"{name}: {last_error}"


def load_previous() -> dict:
    try:
        return json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def main() -> int:
    source = json.loads(FRIENDS_PATH.read_text(encoding="utf-8"))
    friends = [item for item in source.get("friends", []) if isinstance(item, list) and len(item) >= 2]
    previous = load_previous()
    previous_articles = previous.get("article_data", []) if isinstance(previous.get("article_data"), list) else []
    articles: list[dict] = []
    failures: list[str] = []
    successful_sites: set[str] = set()

    with ThreadPoolExecutor(max_workers=min(8, max(1, len(friends)))) as executor:
        future_map = {executor.submit(fetch_friend, friend): friend for friend in friends}
        for future in as_completed(future_map):
            friend = future_map[future]
            try:
                items, _, error = future.result()
            except Exception as exc:
                items, error = [], f"{friend[0]}: {exc}"
            if items:
                articles.extend(items)
                successful_sites.add(friend[1].rstrip("/"))
            else:
                failures.append(error or f"{friend[0]}: feed unavailable")
                site = friend[1].rstrip("/")
                stale = [dict(item) for item in previous_articles if str(item.get("site_url", "")).rstrip("/") == site]
                for item in stale[:MAX_ARTICLES_PER_SITE]:
                    item["_timestamp"] = parse_datetime(item.get("created", "")).timestamp()
                articles.extend(stale[:MAX_ARTICLES_PER_SITE])

    if friends and not successful_sites:
        print("All feeds failed; preserving the previous JSON.", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    unique: dict[str, dict] = {}
    for article in articles:
        key = article.get("link") or f"{article.get('author')}::{article.get('title')}"
        if key not in unique or article.get("_timestamp", 0) > unique[key].get("_timestamp", 0):
            unique[key] = article
    articles = sorted(unique.values(), key=lambda item: item.get("_timestamp", 0), reverse=True)[:MAX_TOTAL_ARTICLES]
    for floor, article in enumerate(articles, start=1):
        article.pop("_timestamp", None)
        article["floor"] = floor

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    stats = {
        "friends_num": len(friends),
        "active_num": len(successful_sites),
        "error_num": len(failures),
        "article_num": len(articles),
        "last_updated_time": now,
    }
    payload = {"article_data": articles, "statistical_data": stats}

    previous_stats = dict(previous.get("statistical_data", {})) if isinstance(previous.get("statistical_data"), dict) else {}
    previous_time = previous_stats.pop("last_updated_time", "")
    comparable_stats = dict(stats)
    comparable_stats.pop("last_updated_time", None)
    if previous.get("article_data") == articles and previous_stats == comparable_stats and previous_time:
        payload["statistical_data"]["last_updated_time"] = previous_time

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(articles)} articles from {len(successful_sites)}/{len(friends)} feeds.")
    for failure in failures:
        print(f"- {failure}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
