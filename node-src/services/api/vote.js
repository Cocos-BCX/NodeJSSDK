import { Apis } from 'bcxjs-ws';
import Immutable from "immutable";
import * as types from '../../mutations';
import API from '../api';
import helper from "../../lib/common/helper";

import {ChainStore, FetchChainObjects} from "bcxjs-cores";

let _state={
    all_witnesses: Immutable.List(),
    all_committee: Immutable.List()
};

export const publishVotes=(store,witnesses_ids,committee_ids,new_proxy_id,callback,onlyGetFee,feeAssetId)=>{
    let {rootGetters,getters,dispatch}=store;
    let updated_account = rootGetters["user/getAccountObject"];
        let updateObject = {account: updated_account.id};
        let new_options = {memo_key: updated_account.options.memo_key};

        let {vote_ids}=getters.getVotesState;

        new_options.voting_account = new_proxy_id ? new_proxy_id : "1.2.2";
        new_options.num_witness = witnesses_ids.length;
        new_options.num_committee = committee_ids.length;

        updateObject.new_options = new_options;
        // Set fee asset
        updateObject.fee = { 
            amount: 0,
            asset_id:"1.3.0"
        };

  
        // Submit votes
        FetchChainObjects(
            ChainStore.getWitnessById,
            witnesses_ids,
            //witnesses.toArray(),
            4000
        ).then(res => {
                let witnesses_vote_ids = res.map(o => o.get("vote_id"));
                return Promise.all([
                    Promise.resolve(witnesses_vote_ids),
                    FetchChainObjects(
                        ChainStore.getCommitteeMemberById,
                        committee_ids,
                        4000
                    )
                ]);
            })
            .then(res => {
                updateObject.new_options.votes = res[0]
                    .concat(res[1].map(o => o.get("vote_id")))
                    .concat(
                        vote_ids.toArray()
                            .filter(id => {
                                return id.split(":")[0] === "2";
                            })     
                    )
                    .sort((a, b) => {
                        let a_split = a.split(":");
                        let b_split = b.split(":");

                        return (
                            parseInt(a_split[1], 10) - parseInt(b_split[1], 10)
                        );
                    });


                    dispatch("transactions/_transactionOperations",{
                        operations:[{
                          type:"account_update",
                          params:{
                              updateObject,
                              fee_asset_id:feeAssetId
                          }
                        }],
                        callback,
                        onlyGetFee
                    },{root:true}).then(res=>{
                        callback&&callback(res);
                    })
            });
}


export const _getVoteObjects= async (store,type = "witnesses", vote_ids) => {
    let current = _state[`all_${type}`]=Immutable.List();
    const isWitness = type === "witnesses";
    let lastIdx;
    if (!vote_ids) {
        vote_ids = [];
        let globalObject=store.rootGetters["vote/globalObject"];
        if(!globalObject){
            globalObject=await API.Explorer.getGlobalObject();
            if(globalObject.code!=1){
                let {getVoteObjects_callback}=store.state;
                getVoteObjects_callback&&getVoteObjects_callback(globalObject);
                return;
            }
            globalObject=globalObject.data;
        }

        globalObject=Immutable.fromJS(globalObject);
        store.commit(types.SET_GLOBAL_OBJECT,globalObject)
        let active =globalObject
            .get(
                isWitness ? "active_witnesses" : "active_committee_members"
            )
            .sort((a, b) => {
                return (
                    parseInt(a.split(".")[2], 10) -
                    parseInt(b.split(".")[2], 10)
                );
            });
        const lastActive = active.last() || `1.${isWitness ? "6" : "5"}.1`;

        lastIdx = parseInt(lastActive.split(".")[2], 10);
        for (var i = isWitness?1:0; i <= lastIdx + 10; i++) {
            vote_ids.push(`1.${isWitness ? "6" : "5"}.${i}`);
        }
    } else {
        lastIdx = parseInt(vote_ids[vote_ids.length - 1].split(".")[2], 10);
    }
    FetchChainObjects(ChainStore.getObject, vote_ids, 5000, {}).then(
        vote_objs => {
            let vote_ids_obj={};
            vote_objs=vote_objs.filter(a=>{
                if(!!a){
                    vote_ids.push(a.id);
                    return true;
                }
            });
            if(vote_objs.length){
                store.commit(types.SET_VOTE_IDS,vote_ids);
                _state[`all_${type}`] = current.concat(
                    Immutable.List(
                        vote_objs
                            .map(a =>{   
                                let acc_id=a.get(
                                    isWitness
                                        ? "witness_account"
                                        : "committee_member_account"
                                )
                                vote_ids_obj[acc_id]=a;
                                return acc_id;
                            })
                    )
                );

                store.commit(types.SET_VOTE_IDS_OBJ,vote_ids_obj);
                store.commit(types.SET_ALL_WITNESSES_COMMITTEE,_state);
            }
                       
            // store.dispatch("formatVotes",type);
            if (!!vote_objs[vote_objs.length - 1]) {
                // there are more valid vote objs, fetch 10 more
                vote_ids = [];
                for (var i = lastIdx + 11; i <= lastIdx + 20; i++) {
                    vote_ids.push(`1.${isWitness ? "6" : "5"}.${i}`);
                }
                return _getVoteObjects(store,type,vote_ids);
            }else{
                updateAccountData(store,type)
            }
        }
    );
};

const updateAccountData=async (store,type)=>{
    let {commit,rootGetters}=store;
    let query_account=rootGetters["vote/queryAccount"];
    let loginUserName=rootGetters["user/getUserName"];
    if((!loginUserName&&!query_account)||rootGetters["vote/isExplorer"]){
        formatVotes(store,"");
        return;
    }
    let account=await API.Account.getUser(query_account?query_account:loginUserName,false);
    if(account.code!=1){
        store.state.getVoteObjects_callback&&store.state.getVoteObjects_callback(account);
        return;
    }

    account=account.data.account;
    account=Immutable.fromJS(account);
    let proxyId=account.getIn(["options","voting_account"]);
    let proxy_account_id=proxyId === "1.2.2" ? "" : proxyId;
    let proxy=null;
    if(proxy_account_id){
        proxy=await API.Account.getUser(proxy_account_id,false);
        if(proxy.success){
            proxy=proxy.data.account;
        }
        if(proxy){
            proxy=Immutable.fromJS(proxy);
        }
    }
    
    let options = account.get("options");
    let proxyOptions = proxy ? proxy.get("options") : null;
    let current_proxy_input = proxy ? proxy.get("name") : "";
    
    if (proxy_account_id === "1.2.2") {
        proxy_account_id = "";
        current_proxy_input = "";
    }
  
    let votes = options.get("votes");
    let reg=new RegExp(type=="witnesses"?/^1:\d+$/:/^0:\d+$/);
    let vote_ids = votes.toArray().filter(vote_id=>{
        return vote_id.match(reg);
    });
    let vids = Immutable.Set(vote_ids);
  
    let proxyPromise = null,
        proxy_vids = Immutable.Set([]);
    const hasProxy = proxy_account_id !== "1.2.2";
    if (hasProxy && proxyOptions) {
        let proxy_votes = proxyOptions.get("votes");
        let proxy_vote_ids = proxy_votes.toArray();
        proxy_vids = Immutable.Set(proxy_vote_ids);
        ChainStore.getObjectsByVoteIds(proxy_vote_ids);
        proxyPromise = FetchChainObjects(
            ChainStore.getObjectByVoteID,
            proxy_vote_ids,
            10000
        );
    }else{
       ChainStore.getObjectsByVoteIds(vote_ids);
    }

    Promise.all([
        FetchChainObjects(ChainStore.getObjectByVoteID, vote_ids, 10000),
        // proxyPromise
    ]).then(res => {  
        const [vote_objs, proxy_vote_objs] = res;
        function sortVoteObjects(objects) {
            let witnesses = new Immutable.List();
            let committee = new Immutable.List();
            let workers = new Immutable.Set();
            objects.forEach(obj => {
                let account_id = obj.get("committee_member_account");
                if (account_id) {
                    committee = committee.push(account_id);
                } else if ((account_id = obj.get("worker_account"))) {
                    // console.log( "worker: ", obj );
                    //     workers = workers.add(obj.get("id"));
                } else if ((account_id = obj.get("witness_account"))) {
                    witnesses = witnesses.push(account_id);
                }
            });
  
            return {witnesses, committee, workers};
        }
        let {witnesses, committee, workers} = sortVoteObjects(vote_objs);
        let {
            witnesses: proxy_witnesses,
            committee: proxy_committee,
            workers: proxy_workers
        } = sortVoteObjects(proxy_vote_objs || []);
        let state = {
            proxy_account_id,
            current_proxy_input,
            witnesses: witnesses,
            committee: committee,
            workers: workers,
            proxy_witnesses: proxy_witnesses,
            proxy_committee: proxy_committee,
            proxy_workers: proxy_workers,
            vote_ids: vids,
            proxy_vote_ids: proxy_vids,
            prev_witnesses: witnesses,
            prev_committee: committee,
            prev_workers: workers,
            prev_vote_ids: vids
        };
        commit(types.SET_VOTES_STATE,state);
  
        formatVotes(store,proxy_account_id);
    }).catch(e=>{
        let {getVoteObjects_callback}=store.state;
        getVoteObjects_callback&&getVoteObjects_callback({code:148,message:"Request timeout, please try to unlock the account or login the account"});
    });
  }

  //process formatted voting data
export const formatVotes=async (store,proxy_account_id)=>{
    let {state,rootGetters,getters,dispatch}=store;

    let  core_asset=await dispatch("assets/fetchAssets",{assets:["1.3.0"],isOne:true},{root:true});

    let type=getters["all_type"];
    let items=getters["alls"]["all_"+type].filter(i => {
        if (!i) return false;
        //if (this.state.item_name_input) return i.get("name").indexOf(this.state.item_name_input) !== -1;
        return true;
    })
    items=items.map(account=>{
        return store.dispatch("user/getUserInfo",{account,isCache:true},{root:true});
    })
    Promise.all(items).then(function(respDataArr) {

        respDataArr=respDataArr.filter(acc_res=>{
            return acc_res.code==1;
        })
        respDataArr=respDataArr.map(acc_res=>{
            return acc_res.data.account;
        })
        
        items=Immutable.fromJS(respDataArr);
        let vote_ids_obj=getters["vote_ids_obj"];
        items=items.sort((a, b) => {
            let {votes: a_votes} = getWitnessOrCommittee(
                type,
                a
            );
            let {votes: b_votes} = getWitnessOrCommittee(
                type,
                b
            );
            if (a_votes !== b_votes) {
                return parseInt(b_votes, 10) - parseInt(a_votes, 10);
            } else if (a.get("name") > b.get("name")) {
                return 1;
            } else if (a.get("name") < b.get("name")) {
                return -1;
            } else {
                return 0;
            }
        }).map((account, idx) => {
            let supporteds=getters["getVotesState"]?getters["getVotesState"][(proxy_account_id?"proxy_":"")+type]:null;
            let action =supporteds &&supporteds.includes(account.get("id"));
                    // ? "remove"
                    // : "add";
            let {url, votes,id} = getWitnessOrCommittee(type, account);
            let link = url && url.length > 0 && url.indexOf("http") === -1
                ? "http://" + url
                : url;
            let isActive =getters["globalObject"].get(
                "active_"+type+(type=="committee"?"_members":"")
            ).includes(id);
            
        
            votes=helper.getFullNum(votes/Math.pow(10,core_asset.precision));
            votes=votes.toFixed(3);

            let account_id=account.get("id");

            let vote_obj=vote_ids_obj[account_id];
            let {vote_id,total_missed,last_confirmed_block_num,last_aslot}=vote_obj.toJS();

            let vote_account={
                account_name:account.get("name"),
                url,
                votes,
                active:isActive,
                supported:!!action,
                account_id,
                type,
                vote_id
            }
            if(type=="witnesses"){
                vote_account.total_missed=total_missed;
                vote_account.last_confirmed_block_num=last_confirmed_block_num;
                vote_account.last_aslot=last_aslot;
                vote_account.witness_id=vote_obj.get("id");
            }else if(type=="committee"){
                vote_account.committee_id=vote_obj.get("id");
            }
            return vote_account;
        });

        let {getVoteObjects_callback}=store.state;

        getVoteObjects_callback&&getVoteObjects_callback({code:1,data:items.toJS()});
    });
   
}

function getWitnessOrCommittee(type, acct) {
    let url = "",
        votes = 0,
        account;
    if (type === "witnesses") {
        account = ChainStore.getWitnessById(acct.get("id"));
    } else if (type === "committee") {
        account = ChainStore.getCommitteeMemberById(acct.get("id"));
    }
    url = account ? account.get("url") : url;
    votes = account ? account.get("total_votes") : votes;
    return {
        url,
        votes,
        id: account.get("id")
    };
  }

export default {
    _getVoteObjects,
    formatVotes,
    publishVotes
};