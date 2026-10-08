# Rakib Phone API 📱🇧🇩

Phone model/name দিয়ে full specification এবং Bangladesh price বের করার Node.js API।

## Features

- Phone model search
- Full specs extraction
- Official BD price
- Unofficial BD price থাকলে সেটাও
- RAM / ROM / display / chipset / CPU / GPU
- Camera
- Battery / charging
- Network / SIM / Wi-Fi / Bluetooth / NFC
- Dimensions / weight / colors
- Sensors
- Image URLs
- 6-hour server-side cache

## Install

```bash
npm install
npm start
```

Server:

```text
http://localhost:3000
```

## API

### Phone info

```text
GET /api/phone?model=Redmi%2010C
```

Example:

```bash
curl "http://localhost:3000/api/phone?model=Redmi%2010C"
```

### Search

```text
GET /api/search?q=Redmi%2010C
```

### Health

```text
GET /health
```

## Render deploy

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

Environment:

```text
NODE_ENV=production
```

## Important

This project reads publicly available product information from MobileDokan. Website HTML structure changes হলে scraper-এর selector update করতে হতে পারে।

Price source অনুযায়ী official/unofficial price আলাদা হতে পারে। API price-কে "latest fetched price" হিসেবে ব্যবহার করাই ভালো।

## Bot usage

```js
const axios = require("axios");

const model = "Redmi 10C";

const { data } = await axios.get(
  "https://YOUR-API.onrender.com/api/phone",
  { params: { model } }
);

console.log(data.data);
```
