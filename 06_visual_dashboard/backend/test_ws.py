import asyncio
import json
import websockets
import requests

async def test_ws():
    async with websockets.connect("ws://localhost:8000/ws/chat") as websocket:
        data = {
            "nodes": [
                {"id": "1", "data": {"label": "PromptTemplate"}},
                {"id": "2", "data": {"label": "ChatModel", "provider": "gemini"}},
                {"id": "3", "data": {"label": "StrOutputParser"}}
            ],
            "edges": [],
            "mode": "step0"
        }
        res = requests.post("http://localhost:8000/api/flow/execute", json=data)
        print("POST response:", res.json())
        while True:
            try:
                msg = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                print("WS received:", msg)
            except asyncio.TimeoutError:
                print("Timeout waiting for more messages.")
                break
asyncio.run(test_ws())
