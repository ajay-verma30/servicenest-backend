const nodemailer = require('nodemailer')
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service:'gmail',   
    auth:{
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sentOtp = async(to, otp) =>{
    await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to,
        subject: "Your OTP code",
        text: `Your OTP code is ${otp}. It will expire in 5 minutes.`
    })
}


module.exports = sentOtp;
