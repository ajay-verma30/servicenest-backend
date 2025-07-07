const express = require('express')
const cors = require('cors')
const morgan = require('morgan')
const app = express()

app.use(morgan(':method :url :status :res[content-length] - :response-time ms'))
app.use(cors());
app.use(express.json());


app.use('/users', require('./routes/users'));
app.use('/tickets',require('./routes/tickets'));
app.use('/comments',require('./routes/comments'));

port = process.env.PORT || 3000;

app.listen(port,()=>{
    console.log(`http://localhost:${port}`)
})