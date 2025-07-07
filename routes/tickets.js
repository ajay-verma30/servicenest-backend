const express= require('express');
const router = express.Router();
const mysqlconnect = require('../db/conn');
const promiseConn = mysqlconnect().promise();
const authenticateToken = require('../Auth/tokenAuthentication')


//create ticket
router.post('/new', authenticateToken, async(req,res)=>{
    try{
        const createdAt = new Date();
        const {id} = req.user;
        const {subject, description,priority} = req.body;
        const insertQuery = "INSERT INTO tickets(user_id, subject,description, priority, created_at)VALUES(?,?,?,?,?)";
        const [result] = await promiseConn.query(insertQuery, [id,subject,description,priority,createdAt])
        if(result.affectedRows !== 1){
            return res.status(500).json({message:"Failed to create user. Try again later!"})
        }
        return res.status(201).json({message:"Ticket Created Successfully"})
    }
    catch(e){
        return res.status(500).json({message:"Internal Server Error", error:e})
    }
})


//get my tickets
router.get('/my-tickets', authenticateToken, async(req,res)=>{
    try{
        const {id} = req.user;
         const { status, priority, page = 1, limit = 10 } = req.query;
        let baseQuery = "SELECT * FROM tickets WHERE user_id = ?";
        const params = [id];

        if(status){
            baseQuery += " AND status = ?";
            params.push(status);
        }

        if(priority){
            baseQuery += " AND priority = ?";
            params.push(priority);
        }
            baseQuery += " ORDER BY created_at DESC";

             const offset = (parseInt(page) - 1) * parseInt(limit);
    baseQuery += " LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);

        const [tickets] = await promiseConn.query(baseQuery, params);
        return res.status(200).json({tickets})
    }
    catch(e){
        return res.status(500).json({message:"Internal Server Error", error:e})
    }
})


//summary of my tickets
router.get('/my-tickets-summary', authenticateToken, async (req, res) => {
  try {
    const { id } = req.user;
    console.log(id)
    const [summary] = await promiseConn.query(`
      SELECT 
        COUNT(*) AS total,
        COUNT(CASE WHEN status = 'open' THEN 1 END) AS open,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) AS closed,
        COUNT(CASE WHEN priority = 'high' THEN 1 END) AS high
      FROM tickets
      WHERE user_id = ?
    `, [id]);

    return res.status(200).json({ summary: summary[0] });

  } catch (e) {
    return res.status(500).json({ message: "Internal Server Error", error: e });
  }
});



//specific ticket
router.get('/:id', authenticateToken, async(req,res)=>{
    try{
        const {id}=req.params;
        const [searchTicket] = await promiseConn.query("SELECT * FROM tickets WHERE id = ?",[id]);
        if(searchTicket.length <= 0){
            return res.status(404).json({message:"Ticket not found"});
        }
        const [comments] = await promiseConn.query(
            `SELECT c.*, CONCAT(u.f_name, ' ', u.l_name) AS name
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.ticket_id = ?
            ORDER BY c.created_at DESC`,[id]
        );
        return res.status(200).json({ticket: searchTicket[0], comments: comments || []});
    }
    catch(e){
        return res.status(500).json({message:"Internal Server Error", error:e});
    }
})


module.exports = router;