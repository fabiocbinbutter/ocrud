var util=require('util');
module.exports={
 first:	function first(arr){return arr[0]}
,last:	function last(arr){return arr[arr.length-1]}
,sum:	function sum(a,b){return a+b}
,min:	function min(a,b){return a<b?a:b}
,max:	function max(a,b){return a>b?a:b}
,unique:function unique(x,i,a){return a.indexOf(x)==i}
,not:	function not(f){return function(x){return !(f(x))}}
,truthy:function truthy(x){return !!x}
,flatten:function flatten(a,b){return a.concat(b)}
,sorter:function sorter(f){return function(a,b){var fa=f(a),fb=f(b);return fa>fb?1:fa<fb?-1:0;}}
,arity1:function arity1(f){return function(a){return f(a)}}
,set:	function set(obj,path,val,asArr){ //TODO: make non mutative
		if(path.split){path=path.split('.')}
		var head=path[0];
		if(path.length==1){
				if(val!==undefined){
						if(asArr){obj[head]=(obj[head]||[]).concat(val)}
						else{obj[head]=val}
					}
			}else{
				obj[head]=obj[head]||{};
				set(obj[head],path.slice(1),val,asArr)
			}
		return obj;
	}
,get:	function get(obj,path){
		if(path.split){path=path.split('.')}
		if(!path.slice){path=[path]}
		var head=path[0];
		if(path.length==1){
				return obj && obj[head];
			}else{
				return get(obj[head],path.slice(1))
			}
	}
,objByOf: function objByOf(byKeys,ofKey,asArr){
		byKeys=(byKeys instanceof Array ? byKeys : [byKeys])
		return function(accum,x,i){
				return set(accum,byKeys.map(k=>get(x,k)),ofKey?get(x,ofKey):x,asArr)
			}
	}
,objArr: function objArr(o,keyString){ //Return an array of objects with a key property
		return Object.keys(o).map(k=>{
				var baseObj={}
				baseObj[keyString||"key"]=k;
				return Object.assign(baseObj, (typeof o[k] == "object" ? o[k] : {value:o[k]}))
			})
	}
,caught: function caught(fn){
		return function(req,res,next){
				try{
						fn(req,res,next)
					}catch(err){
						next(err)
					}
			}
	}
,peek:function peek(o){
			console.log(
					util.inspect(o,{colors:true, depth:1, maxArrayLength:5})
					.replace(/"([^"]{40})([^"]|\")+"/,'"$1"')
					.replace(/(\n\s+([_a-zA-Z$][_0-9a-zA-Z$]*)?:)\s+([_a-zA-Z$][_0-9a-zA-Z$]* {)/g,"$1 $2")
				);
			return o;
		}
,timer:function timer(name){
		var seq=[{evt:name,time:process.hrtime()}];
		return function(evt){
				return function(passthru){
						if(typeof evt=="string"){
								seq.push({evt:evt,time:process.hrtime(seq[0].time)})
							}
						if(typeof evt=="function"){
								evt(seq);
							}
						return passthru;
					}
			}
	}
