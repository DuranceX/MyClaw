#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
用户数据库查询脚本（模拟数据）
支持按 ID 或姓名查询用户信息
"""

import argparse
import json
import sys

# ── 模拟数据库 ──────────────────────────────────────────────────────────────
MOCK_USERS = [
    {
        "id": 1,
        "name": "张伟",
        "email": "zhangwei@example.com",
        "department": "技术部",
        "position": "后端工程师",
        "join_date": "2020-03-01",
        "status": "在职",
    },
    {
        "id": 2,
        "name": "李娜",
        "email": "lina@example.com",
        "department": "产品部",
        "position": "产品经理",
        "join_date": "2019-07-15",
        "status": "在职",
    },
    {
        "id": 3,
        "name": "王芳",
        "email": "wangfang@example.com",
        "department": "技术部",
        "position": "前端工程师",
        "join_date": "2021-06-15",
        "status": "在职",
    },
    {
        "id": 4,
        "name": "赵磊",
        "email": "zhaolei@example.com",
        "department": "市场部",
        "position": "市场专员",
        "join_date": "2018-11-20",
        "status": "离职",
    },
    {
        "id": 5,
        "name": "陈静",
        "email": "chenjing@example.com",
        "department": "人事部",
        "position": "HR 主管",
        "join_date": "2017-04-10",
        "status": "在职",
    },
    {
        "id": 6,
        "name": "刘洋",
        "email": "liuyang@example.com",
        "department": "技术部",
        "position": "算法工程师",
        "join_date": "2022-01-08",
        "status": "在职",
    },
    {
        "id": 7,
        "name": "李明",
        "email": "liming@example.com",
        "department": "运营部",
        "position": "运营主管",
        "join_date": "2020-09-01",
        "status": "在职",
    },
    {
        "id": 8,
        "name": "黄敏",
        "email": "huangmin@example.com",
        "department": "财务部",
        "position": "财务分析师",
        "join_date": "2016-05-22",
        "status": "在职",
    },
    {
        "id": 9,
        "name": "张丽",
        "email": "zhangli@example.com",
        "department": "市场部",
        "position": "品牌经理",
        "join_date": "2023-03-14",
        "status": "在职",
    },
    {
        "id": 10,
        "name": "孙浩",
        "email": "sunhao@example.com",
        "department": "技术部",
        "position": "DevOps 工程师",
        "join_date": "2021-10-05",
        "status": "在职",
    },
]
# ────────────────────────────────────────────────────────────────────────────


def query_by_id(user_id: int):
    """按 ID 精确查询"""
    for user in MOCK_USERS:
        if user["id"] == user_id:
            return [user]
    return []


def query_by_name(name: str):
    """按姓名模糊查询（包含即匹配）"""
    return [u for u in MOCK_USERS if name in u["name"]]


def list_all():
    """返回所有用户"""
    return MOCK_USERS


def main():
    parser = argparse.ArgumentParser(description="查询用户信息（模拟数据库）")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--id", type=int, metavar="USER_ID", help="按用户 ID 查询")
    group.add_argument("--name", type=str, metavar="NAME", help="按姓名查询（支持模糊）")
    group.add_argument("--list", action="store_true", help="列出所有用户")

    args = parser.parse_args()

    if args.id is not None:
        results = query_by_id(args.id)
        if not results:
            output = {"success": False, "message": f"未找到 ID 为 {args.id} 的用户", "data": []}
        else:
            output = {"success": True, "count": len(results), "data": results}

    elif args.name:
        results = query_by_name(args.name)
        if not results:
            output = {"success": False, "message": f"未找到姓名包含「{args.name}」的用户", "data": []}
        else:
            output = {"success": True, "count": len(results), "data": results}

    elif args.list:
        results = list_all()
        output = {"success": True, "count": len(results), "data": results}

    else:
        parser.print_help()
        sys.exit(1)

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
