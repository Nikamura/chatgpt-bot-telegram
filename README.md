# ChatGPT for Telegram

### Commands

- /simple

There is no history.

- /chat

There is individual history for each user.

- /shared

There is shared history for everyone.

### Running

```
OPENAI_API_KEY=
TELEGRAM_BOT_KEY=
```

### Building

```
docker buildx build -f Dockerfile . --push --platform=linux/amd64 --tag registry.karolis.host/chatgptbot:latest
```
