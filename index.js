const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);
const app = express();
const port = process.env.PORT || 5000;

// midleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// console.log(process.env.DB_PASS, process.env.DB_USER);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jq69c8i.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const doctorCollection = client.db("Dental_Care").collection("doctors");
    const appointmentCollection = client
      .db("Dental_Care")
      .collection("appointments");
    const userCollection = client.db("Dental_Care").collection("users");
    const paymentCollection = client.db("Dental_Care").collection("payments");

    // jwt api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_TOKEN, { expiresIn: "3h" });
      // console.log(token);
      res.send({ token });
    });

    // middlewares
    const verifyToken = async (req, res, next) => {
      // console.log(req.headers);
      if (!req.headers?.authorization) {
        return res.status(401).send({ message: "Unauthorized access" });
      }
      const token = req.headers?.authorization.split(" ")[1];
      jwt.verify(token, process.env.JWT_TOKEN, (err, decoded) => {
        if (err) {
          return res.status(403).send({ message: "forbidden access" });
        }
        req.decoded = decoded;
        next();
      });
      // next()
    };

    const verifyAdmin = async (req, res, next) => {
      console.log(req.decoded);
      const email = req.decoded.email;
      const query = {email: email};
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if(!isAdmin){
        return res.status(403).send({message: 'forbidden access'})
      }
      next();
    }

    // users api
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    // is admin api
    app.get("/users/admin/:email", verifyToken, verifyAdmin, async (req, res) => {
      const query = { email: req.params.email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
        if (admin) {
          return res.send({ admin });
        }
        else{
          return res.send({admin: false})
        }
      } else {
        return res.status(401).send({ message: "unauthorized access" });
      }
    });

    app.patch("/users", verifyToken, verifyAdmin, async (req, res) => {
      const userFilter = req.body;
      const options = { upsert: true };
      const name = req.body.name;
      const email = req.body.email;
      const updatedDoc = {
        $set: {
          name,
          email,
        },
      };
      const result = await userCollection.updateOne(
        userFilter,
        updatedDoc,
        options
      );
      res.send(result);
    });

    app.patch("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const user = await userCollection.findOne(query);
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await userCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // doctors api
    app.get("/doctors", async (req, res) => {
      const result = await doctorCollection.find().toArray();
      res.send(result);
    });

    app.get("/doctors/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await doctorCollection.findOne(query);
      res.send(result);
    });

    app.post('/doctors', verifyToken, verifyAdmin, async(req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    })

    app.delete("/doctors/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await doctorCollection.deleteOne(query);
      res.send(result);
    });

    // appointment related api
    app.get("/appointments/:email", verifyToken, async (req, res) => {
      const query = { bookedBy: req.params.email };
      const result = await appointmentCollection.find(query).toArray();
      if (!result) {
        return res.send([]);
      }
      res.send(result);
    });

    app.patch("/appointments/:id", verifyToken, async(req, res) => {
      const review = req.body;
      const id = req.params.id;
      const query = {_id: new ObjectId(id)};
      const updatedDoc = {
        $set: {
          review: review
        }
      }
      const result = await appointmentCollection.updateOne(query, updatedDoc);
      res.send(result)
    })

    app.post("/appointments", verifyToken, async (req, res) => {
      const query = req.body;
      const result = await appointmentCollection.insertOne(query);
      res.send(result);
    });

    // generate client secret for stripe payment 
    app.post('/create-payment-intent', verifyToken, async(req, res) => {
      const {price} = req.body;
      const amount = parseInt(price * 100);
      if(!price || amount < 1){
        return;
      }
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      })
      res.send({clientSecret: paymentIntent.client_secret})
    })

    // save payment info in the paymentCollection 
    app.post('/payments', verifyToken, async(req, res) => {
      const payment = req.body;
      const existingPayment = await paymentCollection.findOne({
        transactionId: payment.transactionId,
      })
      if(existingPayment){
        res.send({message: 'Payment already exists'})
      }
      const result = await paymentCollection.insertOne(payment);
      res.send(result);
    })


    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Dental care server is running");
});

app.listen(port, () => {
  console.log("listening to port", port);
});
