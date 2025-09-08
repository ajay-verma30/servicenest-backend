const express = require('express')
const route = express.Router();
const mysqlconnect = require('../../db/conn')
const promiseConn = mysqlconnect().promise();
const { nanoid } = require('nanoid')
const authToken = require('../../Auth/tokenAuthentication')


route.post('/new', async(req,res)=>{
    try{
        const org_id = nanoid(7);
        const created_at = new Date();
        const {
            name,
            domain,
            city,
            country,
            primary_contact_name,
            primary_contact
        } = req.body;

        const insertQuery = "INSERT INTO organizations(id,name,domain,city, country, primary_contact_name, primary_contact, created_at)VALUES(?,?,?,?,?,?,?,?)";
        const [result] = await promiseConn.query(insertQuery, [org_id, name, domain, city, country, primary_contact_name, primary_contact, created_at]);
        if(result.affectedRows !== 1){
            return res.status(400).json({message:"Unable to create the organization. Please try again later"});
        }
        return res.status(201).json({message:"Organization created"});
    }
    catch(e){
        return res.status(500).json({message:"Internal Server Error", error:e})
    }
})



route.get('/all',authToken, async(req,res)=>{
    try{
        const getOrg = "SELECT * FROM organizations";
    const [result] = await promiseConn.query(getOrg);
    if(result.length === 0){
        return res.status(404).json({message:"There are no Organizations created at."});
    }
    return res.status(200).json({result:result})
    }
    catch(e){
        return res.status(500).json({message:"Internal Server Error", error:e})
    }
})

module.exports = route;