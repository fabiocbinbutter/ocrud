const Promise=require('bluebird')
const promisify = require("promisify-node")
const fs=require('fs')
const pfs=promisify(fs,undefined,true)
const hanson = require('hanson')
const express = require('express')
const bodyParser = require('body-parser')
const pg=require('pg')
const {	not,unique,truthy,peek} = require('./fabios-functions.js')
const sqlReservedWords=JSON.parse(fs.readFileSync('./sql-reserved-words.json'))
const jsonschema = require('jsonschema').validate

reload()(0,0,console.error)

//Functions
function reload(priorServer){
		return function(req,res,next){
				const app = express()
				pfs.readFile('config.hanson','utf8')
				.then(configStr=>hanson.parse(configStr))
				.then(config=>({
						entities:config.entities.filter(c=>c.name).map(c=>Object.assign({},c,{
								table:dbName(c.table || c.name),
								route:routeName(c.route || c.name)
							})),
						db:new pg.Pool(config.db)
					}))
				.then(peek)
				.then(config=>{//Validate
						var validation=validateConfig(config)
						if(validation.errors.length){
								throw "Server configuration errors:\n> "+validation.errors.join("\n> ")
							}
						return Object.assign({},config,{warnings:validation.warnings})
					})
				.then(ctx=>//Create db tables
						Promise.all(ctx.entities.map(c=>
								ctx.db.query(`CREATE TABLE IF NOT EXISTS ${c.table} (
										id SERIAL PRIMARY KEY,
										eid INT,
										user_id INT NOT NULL,
										edit_dt INT NOT NULL,
										next_dt INT,
										start_dt INT,
										end_dt INT,
										json JSONB
										);
										CREATE INDEX idx_gin_${c.table} ON ${c.table} USING gin (json jsonb_path_ops);
									`)
							))
						.then(()=>ctx)
					)
				.then(ctx=>{//Apply routes
						const app = express()
						const auth = authFromConfig(ctx)
						ctx.entities.forEach(e=>{
								app.use(resLocals(()=>parseInt(Date.now()/1000),"dt"))
								app.get ("/schema"+e.route, auth, expressSchema(e))
								app.get ("/list"+e.route,auth, expressListEntity(e))
								app.post("/new"+e.route, auth, bodyParser,expressNewEntity(e))
								app.get ("/get"+e.route+"/:eid", auth, expressGetEntity(e))
								app.post("/set"+e.route+"/:eid", auth, bodyParser,expressSetEntity(e))
								app.set('json spaces',2)
								app.use(errorHandler)
							})
						app.get("/types", auth, expressTypes(ctx))

						//Shenanigans
						const priorOrNone=priorServer||{close:function(f){f()}};
						res&&res.send(200).json("New config loaded. Restarting webserver...")
						priorOrNone.close(function(){
								const newServer=app.listen(8080,()=>console.log("New server started"))
								app.get("/reload",auth, reload(newServer))
							})
					})
				.catch(next)
			}
	}

function validateConfig(config){
		return {
				errors:[
						msgIfArr("Some config entries have conflicting database names: ",
								config.entities.map(c=>c.table).filter(not(unique))
							),
						msgIfArr("Some config entries have conflicting database names: ",
								config.entities.map(c=>c.route).filter(not(unique))
							)
					].filter(truthy),
				warnings:[]
			}
	}

function expressTypes(config){
		return function(req,res,next){
				res.status(200).json(config.entities.map(e=>({name:e.name,route:e.route})))
			}
	}

function expressSchema(ent){
		return function(req,res,next){
				res.status(200).json(ent.schema||{})
			}
	}

function expressListEntity(ent){
		return function(req,res,next){
				db.query(`
						SELECT state.eid,state.json
						FROM (SELECT MAX(id) as id FROM ${ent.table} GROUP BY eid LIMIT 10) as current
				 		LEFT JOIN ${ent.table} as state on state.id=current.id
					`)
				.then(result=>res.status(200).json(objByOf(result.rows,"eid","json")))
				.catch(next)
			}
	}
function expressNewEntity(ent){
		return function(req,res,next){
				var valid=jsonSchema(req.body,ent.schema);
				if(valid.errors && valid.errors.length){
						throw {
								status:400,
								message:"JSON did not match pattern required for this type of entity.\n "+valid.errors.join("\n")
							}
					}
				db.query(`
						INSERT INTO ${ent.table}
						(eid,	user_id,	edit_dt,	next_dt,	start_dt,	next_dt,	json) values (
						(SELECT COALESCE(MAX(eid),0)+1 FROM ${ent.table}),
						 		0,			$1,
														NULL,		NULL,		NULL,		$2)
						RETURNING eid
						`,[					res.locals.dt,									JSON.stringify(req.body)]
					)
				.then(result=>res.redirect(303,"/get"+ent.route+"/"+result.rows[0].eid))
				.catch(next)
			}
	}

function expressGetEntity(config){
		return function(req,res,next){
				db.query
			}
	}
function expressSetEntity(config){
		return function(req,res,next){

			}
	}

function authFromConfig(config){
		if(!config.authenticators){
				return function(req,res,next){next()}
			}
		//TODO
		return function(req,res,next){
				throw "TODO"
			}
}

function resLocals(f,name){
		return function(req,res,next){
			var val=f(res.locals)
			if(!name){return val}
			res.locals[name]=val
		}
	}

function dbName(str){
		return( sqlReservedWords.indexOf(str)>=0
				? "_"+str
				:str
				.replace(/[^\w\$]+(_+[^\w\$]*)*/g,"_") //Non-word, non-$ runs are replaced with an underscore
				.replace(/^([0-9\$])/,"_$1") //No leading number or $
				.toLowerCase()
			);
	}
function routeName(str){
		("/"+str)
		.replace(/[^\w\/]+(-+[^\w\/]*)*/g,"-") //Non-word, non-slash runs are replaced with a dash
		.replace(/\/\/+/g,"/")//No consecutive slashes
		.replace(/\/$/g,"")//No trailing slash
		.toLowerCase()
	}
function msgIfArr(msg,arr,delim){return arr.length && msg+arr.join(delim||", ")}
function errorHandler (err, req, res, next) {
		if(!err.status /*&& !(err.message && err.message.status)*/){
				console.error("Internal error: ",err)
			}
		res.status(err.status || /*(err.message && err.message.status) ||*/ 500).json({
				error: err.message || err,
				trace:(config.env=='dev' && err.stack ? err.stack.split("\n") : undefined)
			})
	}
/*
function rowsElse(fnOrStatus,msg){
		return function fnRowsElse(result){
				if(result && result.rows && result.rows.length){
						return result.rows
					}else{
						if(typeof fnOrStatus=="function"){
								return fnOrStatus(result)
							}else {
								throw {status:fnOrStatus,message:msg}
							}
					}
			}
	}
*/
