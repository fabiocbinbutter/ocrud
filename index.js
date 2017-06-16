const Promise=require('bluebird')
const promisify = require("promisify-node")
const fs=require('fs')
const pfs=promisify(fs,undefined,true)
const hanson = require('hanson')
const express = require('express')
const bodyParser = require('body-parser')
const pg=require('pg')
const {	not,unique,transpose,truthy,peek} = require('./fabios-functions.js')
const sqlReservedWords=JSON.parse(fs.readFileSync('./sql-reserved-words.json'))
const jsonschema = require('jsonschema').validate
const jsonpath = require('jsonpath')
//const manager=express()


reload()(0,0,console.error)

//Functions
function extend(subjOrHow, howOrNone){
		if(howOrNone){ //Arity-2 version is extend(subj, how)
				return extend(howOrNone)(subjOrHow)
			}
		//Curried version is extend(how)(subj) to use with promises
		const how=subjOrHow;
		return function(subj){
				if(Array.isArray(subj)){
						return subj.map(item=>extend(item,how))
					}
				return Object.assign({},subj,
						typeof how=="function"
						? how(subj) //Extend the subject with a transformation of itself
						: how		//Extend the subject with a given object
					)
			}
	}
function reload(priorServer){
		return function(req,res,next){
				const app = express()
				pfs.readFile('config.hanson','utf8')
				.then(file=>hanson.parse(file))
				.then(extend(config=>({ //Pre-validation transformations
						entities:extend(config.entities,entity=>({
								table:dbName(entity.table || entity.name),
								route:routeName(entity.route || entity.name)
							}))
					})))
				.then(peek)
				.then(extend(validateConfig))
				.then(config=>{
						if(config.errors.length){
								throw "Server configuration errors:\n> "+config.errors.join("\n> ")
							} else { return config}
					})
				.then(extend(config=>({ //Post-validation transformations
						db:new pg.Pool(config.db)
						/* Can I "precompile" validation functions?
						entities:extend(config.entities,entity=>({
								validator:jsonschema(entity.schema)
							})*/
					})))
				.then(ctx=>//Create db tables
						Promise.all(ctx.entities.map(dbCreateTable(ctx)))
						.then(()=>ctx)
					)
				.then(ctx=>{//Apply routes
						const app = express()
						const auth = authFromConfig(ctx)
						app.use(express.static("./static"))
						app.use(resLocals(()=>parseInt(Date.now()/1000),"dt"))

						app.get("/log",(req,res)=>{console.log("/log "+res.locals.dt);res.status(200).json("Ok")})
						ctx.entities.forEach(e=>{
								app.get ("/schema"+e.route, auth, expressSchema(ctx,e))
								app.get ("/list"+e.route,auth, expressListEntity(ctx,e))
								app.post("/new"+e.route, auth, bodyParser,expressNewEntity(ctx,e))
								app.get ("/get"+e.route+"/:eid", auth, expressGetEntity(ctx,e))
								app.post("/set"+e.route+"/:eid", auth, bodyParser,expressSetEntity(ctx,e))
								app.set('json spaces',2)
							})
						app.get("/types", auth, expressTypes(ctx))
						app.use(errorHandler(ctx))

						//Shenanigans
						const priorOrNone=priorServer||{close:function(f){f()}};
						res&&res.status(200).json("New config loaded. Restarting webserver...")
						priorOrNone.close(function(){
								console.log("Ready to start webserver")
								const newServer=app.listen(ctx.webserver.port,()=>console.log("New server started on port "+ctx.webserver.port))
								app.get("/reload",auth, reload(newServer))
							})
					})
				.catch(next)
			}
	}

function validateConfig(config){
		return {
				errors:[
						//database
						!config.db && "Config missing 'db'",
						/*
						 config.db && !config.db.user && "Config property 'db.user' is missing",
						 config.db && !config.db.password && "Config property 'db.password' is missing",
						 config.db && !config.db.database && "Config property 'db.database' is missing",
						 config.db && !config.db.host && "Config property 'db.host' is missing",
						 config.db && !config.db.port && "Config property 'db.port' is missing",
						 */
						//webserver
						!config.webserver && "Config missing 'webserver'",
						config.webserver && !config.webserver.port && "Config missing 'webserver.port'",
						//entities
						msgIfArr("Some entities have conflicting database names: ",
								config.entities.map(c=>c.table).filter(not(unique))
							),
						msgIfArr("Some entities have conflicting route names: ",
								config.entities.map(c=>c.route).filter(not(unique))
							)

					].filter(truthy),
				warnings:[
						(!config.entities || !config.entities.length) && "No entities were configured",

					]
			}
	}

function expressTypes(config){
		return function(req,res,next){
				res.status(200).json(config.entities.map(e=>({name:e.name,route:e.route})))
			}
	}

function expressSchema(ctx,ent){
		return function(req,res,next){
				res.status(200).json(ent.schema||{})
			}
	}

function expressListEntity(ctx,ent){
		return function(req,res,next){
			ctx.db.query(`
						SELECT id,json
						FROM ${ent.table}_curr
						LIMIT 10
					`)
				.then(result=>{
						const cols =
								Array.isArray(ent.listColumns) ? ent.listColumns
								: typeof ent.listColumns == 'object' ? [ent.listColumns]
								: typeof ent.listColumns == 'string' ? [{headerText:"", selector:ent.listColumns}]
								: [{headerText:"JSON",selector:"$"}]
						return res.status(200).json({
								headers:["id"].concat(cols.map(col=>col.headerText)),
								rows:transpose(
										[result.rows.map(r=>r.id)].concat(
										cols.map(col=>jsonpath.query(result.rows,col.selector)))
									)
							})
					})
				.catch(next)
			}
	}

function expressNewEntity(ctx,ent){
		return function(req,res,next){
				var valid=jsonSchema(req.body,ent.schema);
				if(valid.errors && valid.errors.length){
						throw {
								status:400,
								message:"JSON did not match pattern required for this type of entity.\n "+valid.errors.join("\n")
							}
					}
				ctx.db.query(`
						DECLARE new_entity_id bigint;
						BEGIN TRANSACTION;
						INSERT INTO ${ent.table}_curr
							(json) values ($1)
							RETURNING id INTO new_entity_id;
						INSERT INTO ${ent.table}_hist
							(eid::int,		user_id,	prev_dt,	edit_dt,	start_dt,	end_dt,		json) values
							(new_entity_id,	NULL,		NULL,		$2,			NULL,		NULL,		$1);
						SELECT new_entity_id as eid;
						COMMIT;
						`,[JSON.stringify(req.body),res.locals.dt]
					)
				.then(rowsElse(500,"Unknown error inserting into the database"))
				.then(result=>res.redirect(303,"/get"+ent.route+"/"+result.rows[0].eid))
				.catch(next)
			}
	}

function expressGetEntity(ctx,ent){
		return function(req,res,next){
				ctx.db.query(`
						SELECT json FROM ${ent.table}_curr WHERE id=$1
					`,[req.params.eid])
				.then(rowsElse(404,"No entity with the requested id found."))
				.catch(next)
			}
	}
function expressSetEntity(ctx,ent){
		return function(req,res,next){
				ctx.db.query(`
						DECLARE new_entity_id bigint;
						BEGIN TRANSACTION;
						UPDATE ${ent.table}_curr
							SET json = $2
							WHERE id = $1;
						INSERT INTO ${ent.table}_hist
							(eid::int,	user_id,	prev_dt,	edit_dt,	start_dt,	end_dt,		json) values
							($1,		NULL,		NULL,		$3,			NULL,		NULL,		$1);
						COMMIT;
					`,[req.params.eid, req.body, res.locals.dt])
				.then(rowsElse(404,"No entity with the requested id found."))
				.catch(next)
			}
	}

function dbCreateTable(ctx){
		return function(ent){
				return ctx.db.query(`
						BEGIN TRANSACTION;
						CREATE TABLE IF NOT EXISTS ${ent.table}_curr (
							id SERIAL PRIMARY KEY,
							json JSONB
							);
						CREATE TABLE IF NOT EXISTS ${ent.table}_hist (
							id BIGSERIAL PRIMARY KEY,
							eid INT,
							user_id INT NOT NULL,
							prev_dt INT NOT NULL,
							edit_dt INT NOT NULL,
							start_dt INT,
							end_dt INT,
							json JSONB
							);
						CREATE INDEX IF NOT EXISTS idx_gin_${ent.table} ON ${ent.table}_curr USING gin (json jsonb_path_ops);
						COMMIT;
					`)
			}
	}


function authFromConfig(config){
		if(!config.authenticators){
				return function(req,res,next){
						console.warn("No authentication")
						next()
					}
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
				next()
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
		return (
				("/"+str)
				.replace(/[^\w\/]+(-+[^\w\/]*)*/g,"-") //Non-word, non-slash runs are replaced with a dash
				.replace(/\/\/+/g,"/")//No consecutive slashes
				.replace(/\/$/g,"")//No trailing slash
				.toLowerCase()
			);
	}
function msgIfArr(msg,arr,delim){return arr.length && msg+arr.join(delim||", ")}
function errorHandler (config){
		return function(err, req, res, next) {
				if(!err.status /*&& !(err.message && err.message.status)*/){
						console.error("Internal error: ",err)
					}
				res.status(err.status || /*(err.message && err.message.status) ||*/ 500).json({
						error: err.message || err,
						trace:(config.env=='dev' && err.stack ? err.stack.split("\n") : undefined)
					})
			}
	}



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
