const express = require('express');
const app = express();
const cors  = require('cors');
const cookieParser = require('cookie-parser');
const path = require("path");

app.use(cookieParser());
app.use(cors({
    origin: "http://localhost:3001",
    credentials: true,
    optionsSuccessStatus: 200
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const uploadsPath = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsPath));
console.log('Serving uploads from:', uploadsPath);
app.get('/', (req, res) => res.status(200).send("Working"));
app.use('/user', require('./routes/Users/users'));
app.use('/organization', require('./routes/Organization/organization'));
app.use('/teams', require('./routes/Teams/teams'));
app.use('/tickets', require('./routes/Tickets/tickets'));
app.use('/comments', require('./routes/Comments/comment'));
app.use('/groups', require('./routes/Groups/groups'));
app.use('/roles', require('./routes/Roles/role'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));