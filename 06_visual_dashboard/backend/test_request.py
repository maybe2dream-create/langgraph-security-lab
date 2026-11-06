import requests
data = {
    "nodes": [
        {"id": "1", "data": {"label": "PromptTemplate"}},
        {"id": "2", "data": {"label": "ChatModel", "provider": "gemini"}},
        {"id": "3", "data": {"label": "StrOutputParser"}}
    ],
    "edges": [],
    "mode": "step0"
}
try:
    res = requests.post("http://localhost:8000/api/flow/execute", json=data)
    print("Response:", res.json())
except Exception as e:
    print("Error:", e)
