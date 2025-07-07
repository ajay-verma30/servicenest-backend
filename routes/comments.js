const express = require('express')
const router = express.Router()
const mysqlconnect = require('../db/conn');
const promiseConn = mysqlconnect().promise();
const authenticateToken = require('../Auth/tokenAuthentication')


router.post('/new', authenticateToken, async(req,res)=>{
    try{
        const created_at = new Date();
        const {comment, ticketId, inInternal} = req.body;
        const {id} = req.user;
        const [result] = await promiseConn.query("INSERT INTO comments(ticket_id,user_id,comment, created_at, inInternal)VALUES(?,?,?,?,?)", [ticketId, id,comment, created_at, inInternal]);
        if(result.affectedRows !== 1){
            return res.status(400).json({message:"Unable to add comment, right now!"});
        }
        return res.status(201).send("Comment Added")

    }
    catch(e){
        return res.status(500).json({message:"Internal Server Error", error:e})
    }
})



router.get('/comments', authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.query; 

    if (!ticketId) {
      return res.status(400).json({ message: "ticketId is required" });
    }

    const [result] = await promiseConn.query(
      `SELECT 
         comments.id AS commentId, 
         comments.comment, 
         comments.created_at, 
         comments.inInternal,
         users.id AS userId,  
         CONCAT(users.f_name, ' ', users.l_name) AS commented_by, 
         tickets.id AS ticketId 
       FROM comments 
       JOIN users ON comments.user_id = users.id 
       JOIN tickets ON comments.ticket_id = tickets.id 
       WHERE tickets.id = ? 
       ORDER BY comments.created_at DESC`,
      [ticketId]
    );

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ message: "Internal Server Error", error: e });
  }
});


module.exports  = router;