"""
FastAPI 天气查询接口
对照 TypeScript 版本 (app/api/chat/tools/weather.ts) 学习

运行方式：
  pip install fastapi uvicorn httpx python-dotenv
  uvicorn 04-fastapi-weather:app --reload --port 8000

测试：
  GET http://localhost:8000/weather?city=北京
"""

import os
import httpx
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()  # 读取 .env.local 或 .env 文件中的环境变量

API_KEY = os.getenv("QWEATHER_API_KEY", "")
API_HOST = os.getenv("QWEATHER_API_HOST", "")

app = FastAPI(title="天气查询 API", version="1.0.0")


# ── 响应数据结构（对应 TS 的 WeatherNow + city） ──────────────────────────────
# Pydantic BaseModel 相当于 TS 里的 type / interface
# FastAPI 会自动用它做响应的序列化和文档生成
class WeatherResult(BaseModel):
    city: str
    temp: str        # 温度 (°C)
    feelsLike: str   # 体感温度
    text: str        # 天气状况，如"晴"、"多云"
    windDir: str     # 风向
    windScale: str   # 风力等级
    humidity: str    # 相对湿度 (%)
    precip: str      # 当前小时累计降水量 (mm)
    vis: str         # 能见度 (km)


# ── Step 1：城市名 → LocationID ──────────────────────────────────────────────
# 对应 TS 的 lookupLocation()
# httpx 是 Python 的异步 HTTP 客户端，相当于 TS 里的 fetch
async def lookup_location(city: str) -> str:
    url = "https://geoapi.qweather.com/v2/city/lookup"
    params = {
        "location": city,
        "range": "cn",
        "number": 1,
        "lang": "zh",
        "key": API_KEY,
    }

    # async with 相当于 TS 的 await fetch(...)
    # 这里用 AsyncClient 是因为 FastAPI 本身是异步框架
    async with httpx.AsyncClient() as client:
        res = await client.get(url, params=params)
        data = res.json()

    if data.get("code") != "200" or not data.get("location"):
        raise HTTPException(status_code=404, detail=f"找不到城市：{city}（错误码：{data.get('code')}）")

    return data["location"][0]["id"]


# ── Step 2：LocationID → 实时天气 ────────────────────────────────────────────
# 对应 TS 的 fetchWeatherNow()
async def fetch_weather_now(location_id: str) -> dict:
    url = f"https://{API_HOST}/v7/weather/now"
    params = {
        "location": location_id,
        "lang": "zh",
        "unit": "m",
        "key": API_KEY,
    }

    async with httpx.AsyncClient() as client:
        res = await client.get(url, params=params)
        data = res.json()

    if data.get("code") != "200":
        raise HTTPException(status_code=502, detail=f"天气查询失败（错误码：{data.get('code')}）")

    return data["now"]


# ── 路由：GET /weather?city=北京 ─────────────────────────────────────────────
# 对应 TS 版 weatherTool 的 execute 函数
# response_model 告诉 FastAPI 用 WeatherResult 来校验和序列化返回值
@app.get("/weather", response_model=WeatherResult)
async def get_weather(
    city: str = Query(..., description="要查询的城市名称，例如：北京、上海、成都")
):
    """
    查询指定城市的实时天气。

    - **city**: 城市名称（中文）
    """
    location_id = await lookup_location(city)
    now = await fetch_weather_now(location_id)

    return WeatherResult(city=city, **now)


# ── 本地直接运行入口（可选） ──────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("04-fastapi-weather:app", host="0.0.0.0", port=8000, reload=True)
