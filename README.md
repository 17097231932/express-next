# express-next
![logo](https://user-images.githubusercontent.com/61080186/179174030-d8fff031-89f2-4ba5-ac52-9d31c926ced0.png)
The next generation of express.js

## Installation
This repository has not uploaded the npm registry yet.
You can clone this repository for development or using.

```sh
npm i express-next@github:17097231932/express-next
```

## Usage
Almost the same as the original express.js.
You can find examples from this repository.

Here is a simple example:
```js
import express from 'express-next' // yes, we support ES Module

const app = express()

app.get('/', function (req, res) {
  res.send('Hello World')
})

app.listen(3000)
```

## License

[MIT](LICENSE)
- Copyright (c) 2009-2014 TJ Holowaychuk <tj@vision-media.ca>
- Copyright (c) 2013-2014 Roman Shtylman <shtylman+expressjs@gmail.com>
- Copyright (c) 2014-2015 Douglas Christopher Wilson <doug@somethingdoug.com>
