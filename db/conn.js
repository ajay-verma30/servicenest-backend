const mysql = require('mysql2')
require('dotenv').config();

const myconnection = () =>{
   const connection =  mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME
    })

    connection.connect((err)=>{
        if(err){
            console.error("Error in connection", err.message);
            return
        }
        return
    })
    return connection;
}


module.exports = myconnection;