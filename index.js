const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();
const jwt = require('jsonwebtoken');
require('dotenv').config();
const port = process.env.PORT || 5000 ;
 app.use(cors())
 app.use(express.json());
 const stripe = require("stripe")(process.env.PAYMENT_SECRET)
const uri = 'mongodb://localhost:27017';

const client = new MongoClient(uri);

function VerifyJWT(req,res,next){
    const header = req.headers.authorization ;
    if(!header){
        return res.status(403).send("unauthorized access");
    }
    const token = header.split(' ')[1];
    jwt.verify(token,process.env.JWT_TOKEN,(err,decoded)=>{
        if(err){
            return res.status(401).send("forbidden user");
        }
        else{
            req.decoded = decoded
            next();
        }
    })
    
}


async function run(){
   try{
    client.connect()
   }
   catch(error){
    console.log(error.name, error.message)
   }
}
// collection db

const doctorsMeetCollection = client.db("doctorPortal").collection("meetTime");
const bookingCollection = client.db("doctorPortal").collection("bookingAppointment");
const usersCollection = client.db("doctorPortal").collection("users")
const doctorsCollection = client.db('doctorPortal').collection('doctors')
const paymentsCollection = client.db('doctorPortal').collection('payments')


// is users admin
app.get('/users/admin/:email',async(req, res)=>{
    try{
     const email = req.params.email ;
     const query = {email};
     const user = await usersCollection.findOne(query);
     res.send({isAdmin: user});
    }
    catch(e){
     console.log(e.message)
    }
 })
 

// NOTE: ADD PRICE DOCTOR MEET OPTION
// app.get('/doctorsMeetOptio',async(req,res)=>{
//     const query = {};
//     const options = {upsert:true};
//     const updatedDoc = {
//         $set:{
//             price : 200
//         }
//     }
//     const result =await doctorsMeetCollection.updateMany(query,updatedDoc,options)
//     res.send(result)
// })

// get doctors meeting time
app.get('/doctorsMeetOptions',async(req, res)=>{
    try{
        const query = {};
        const date = req.query.date ;
        const bookingQuery = {appointMentDate:date};
    const cursor = doctorsMeetCollection.find(query);
    const result = await cursor.toArray()
    
    const alreadyBooking =await bookingCollection.find(bookingQuery).toArray();
    result.forEach(option=>{
        const optionBook = alreadyBooking.filter(book => book. treatMentName === option.name);
        const bookSlots = optionBook.map(book => book.appointmentTime)

        const remainingBookingSlots =option.slots.filter(slot=>!bookSlots.includes(slot) )
       option.slots = remainingBookingSlots;
      
    })
    
    res.send({
        success:true,
        data:result
    })
     
    
    }
    catch(e){
        res.send({
            success:false,
            message:e.message
        })
    }
}) 

// doctor specialty for add doctor 
app.get('/doctorsSpecialty',async(req,res)=>{
    const query = {};
    const cursor =await doctorsMeetCollection.find(query).project({name:1}).toArray()
    res.send(cursor)
})


// users order get 
app.get('/bookings',VerifyJWT,async(req, res)=>{
    try{
        const email = req.query.email ;
       
    const result =await bookingCollection.find({email:email}).toArray()
    res.send(result)
    }
    catch(e){
        res.send(e.message)
    }

})

// find an appointment with id for payment
app.get('/bookings/:id',async(req, res)=>{
    try{
        const id = req.params.id ;
        const query = {_id: ObjectId(id)};
        const result = await bookingCollection.findOne(query);
        res.send(result)
    }
    catch(e){
        console.log(e.message)
    }
})


// get all users
app.get('/users',VerifyJWT,VerifyAdmin,async(req, res)=>{
   try{
    const query = {};
    const users = await usersCollection.find(query).toArray();
    res.send({
        success:true,
        data:users
    })
   }
   catch(e){
    res.send({
        success:false,
        message:e.message
    })
   }
})



// get user information email and details
app.post('/users',async(req, res)=>{
    const email = req.body;
    const result = await usersCollection.insertOne(email);
    res.send(result);
})

// make admin user
app.put('/users/:id',VerifyJWT,VerifyAdmin,async(req, res )=>{
   try{
    const id = req.params.id ;
    const query = {_id:ObjectId(id)}
    const options = { upsert : true}
    const updatedDoc = {
        $set:{
            role:"admin"
        }
    }
    const result = await usersCollection.updateOne(query,updatedDoc,options)
    res.send(result)
   }
   catch(e){
    console.log(e.name,e.message)
   }
})


// jwt verify token
app.get('/jwt',async(req, res)=>{
    const email = req.query.email ;
    const query = {email:email};
    const user = await usersCollection.findOne(query);
    if(user){
        const token = jwt.sign({email},process.env.JWT_TOKEN,{expiresIn:'7d'});
        return res.send({accessToken:token})
    }
          res.status(403).send({token:""})
    
})


// payment intent
app.post('/create-payment-intent', async(req, res)=>{
    const booking = req.body;
    const price = booking.price;
    const amount = parseFloat(price * 100);
    const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency:'usd',
        "payment_method_types":[
            'card'
        ]
    })
    res.send({
        clientSecret : paymentIntent.client_secret
    })
})

// payments collection
app.post('/payments',async(req, res )=>{
    const payment = req.body ;
    console.log(payment)
    const result = await paymentsCollection.insertOne(payment);
    const id = payment.bookingId ;
    const filter = {_id:ObjectId(id)};
    const updatedDoc ={
        $set:{
            paid:true,
            transitionId:payment.transitionId
        }
    }
    const setBooking = await bookingCollection.updateOne(filter,updatedDoc)
   
    res.send(result)
})


// user booking time collect 
app.post('/bookings',VerifyJWT, async(req, res)=>{
 try{
    const decodedEmail = req.decoded.email ;
    const emailQuery = {email : decodedEmail};
    const user = await usersCollection.findOne(emailQuery);
    if(user.email !== decodedEmail){
       return res.status(401).send("forbidden user");
    }
    const booking = req.body;
    const query ={
        appointMentDate:booking.appointMentDate,
        email:booking.email,
        treatMentName:booking.treatMentName
    }

    const alreadyBooking =await bookingCollection.find(query).toArray();
    if(alreadyBooking.length){
      const message = `You have already booking on ${booking.appointMentDate}`
      return res.send({ 
      
        message });
    }
    const result = await bookingCollection.insertOne(booking);
    res.send({
        success:true,
        data:result
    })
 }
 catch(e){
    res.send({
        success:false,
        message:e.message
    })
 }
})

// add a doctor

app.post('/admin/adddoctor',VerifyJWT,VerifyAdmin,async(req,res)=>{
    const doctor = req.body;
    const result = await doctorsCollection.insertOne(doctor)
    res.send(result)
})

// delete doctor
app.delete('/doctors/:id',VerifyJWT,VerifyAdmin,async(req, res )=>{
    try{
        const id = req.params.id ;
        const query = {_id : ObjectId(id)};
        const result =await doctorsCollection.deleteOne(query)
        res.send({
            success:true,
            data:result
        })

    }
    catch(e){
        res.send({
            success:false,
            message:e.message
        })
    }
})

// get doctors

app.get('/doctors',VerifyJWT,VerifyAdmin,async(req, res)=>{
  try{
    const result = await doctorsCollection.find({}).toArray();
    res.send({
        success:true,
        data:result
    })
  }
  catch(e){
    res.send({
        success:false,
        message:e.message
    })
  }
})



run()


app.get('/',(req,res)=>{
    res.send({
        success:true,
        data:"it's working"
    })
})


 app.listen(port, ()=>{
    console.log(`server connected on port ${port}`);
 })