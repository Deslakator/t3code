# Telegram notifications

A self-hosted server can send Telegram messages when an agent finishes or fails, even with every client closed. Messages include the project, thread title, and an excerpt of the final answer or error. The **Open in T3** button opens a page on your server, which attempts to open the installed app and offers a browser fallback.

Create a bot with **@BotFather**, send it a message, and obtain the destination chat ID using the Telegram Bot API's `getUpdates` method. Store the following JSON in a private file outside your project, readable only by the account running the server (`chmod 600`):

```json
{
  "botToken": "YOUR_BOT_TOKEN",
  "chatId": "YOUR_CHAT_ID",
  "publicUrl": "https://your-t3-server.example.com"
}
```

Set `T3CODE_TELEGRAM_CONFIG_FILE` to the absolute path of this file in the server's environment and restart the server. For a background service, set it in the service configuration. The public URL must be an HTTPS origin without a path, query, or credentials. Your device must be able to reach it.

To disable notifications, remove the environment variable and restart. Configuration changes also require a restart. Keep the token out of chat messages, shell history, and version control.

Notifications cover new activity while the server is running; old results are not replayed at startup. Child agents, stopped runs, and successful automatic context compaction do not send alerts. Completion waits for background work that holds the thread open. Temporary Telegram delivery errors receive two retries; delivery is best effort and messages can be duplicated after an ambiguous network failure. Notification language follows the project and agent content.
