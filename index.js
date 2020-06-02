'use strict';

require('./config.env');
var request = require('request');
var zipcode = require('zipcode');

var stateToChannelMap = {
    'AL': { name: 'alabama', id: 'G4V1D0C4U' }, 
    'AK': { name: 'alaska', id: 'G4WDQCBSB' }, 
    'AZ': { name: 'arizona', id: 'G4UA3TFEF' }, 
    'CA': { name: 'california', id: 'G4V2W2C5V' }, 
    'CO': { name: 'colorado', id: 'G4UD8QX2Q' }, 
    'CT': { name: 'connecticut', id: 'G4VLJB2CF' }, 
    'DC': { name: 'dc', id: 'G4UA3JB7V' }, 
    'FL': { name: 'florida', id: 'G4UEPATBP' }, 
    'GA': { name: 'georgia', id: 'G4UA42WMR' }, 
    'IL': { name: 'illinois', id: 'G4UD4217E' }, 
    'IN': { name: 'indiana', id: 'G4U9NPNV7' }, 
    'IA': { name: 'iowa', id: 'G4V1C5PEY' }, 
    'LA': { name: 'louisiana', id: 'G4VL9DNDU' }, 
    'ME': { name: 'maine', id: 'G4V0628DQ' }, 
    'MD': { name: 'maryland', id: 'G4UA2850B' }, 
    'MA': { name: 'massachusetts', id: 'G4UBZ5AGJ' }, 
    'MI': { name: 'michigan', id: 'G4UD70KT6' }, 
    'MN': { name: 'minnesota', id: 'G4UA1B5M1' }, 
    'MO': { name: 'missouri', id: 'G4UA2KPV1' }, 
    'NJ': { name: 'newjersey', id: 'G4UEQKW13' }, 
    'NM': { name: 'newmexico', id: 'G4V1CBXFE' }, 
    'NY': { name: 'newyork', id: 'G4V29BH1C' }, 
    'NC': { name: 'northcarolina', id: 'G4V2RSNKY' }, 
    'OH': { name: 'ohio', id: 'G4V30J77H' }, 
    'OK': { name: 'oklahoma', id: 'G4U8V22KA' }, 
    'OR': { name: 'oregon', id: 'G4UEQRKN1' }, 
    'PA': { name: 'pennsylvania', id: 'G4UD48YRJ' }, 
    'SC': { name: 'southcarolina', id: 'G4V36DPKR' }, 
    'TN': { name: 'tennessee', id: 'G4UA7P55H' }, 
    'TX': { name: 'texas', id: 'G4V2YEVFZ' }, 
    'VT': { name: 'vermont', id: 'G4VMM777Y' }, 
    'VA': { name: 'virginia', id: 'G4UEPS1JR' }, 
    'WA': { name: 'washingtonstate', id: 'G4TMH227K' }, 
};


var interestToChannelMap = {
    'Policy Research & Advocacy': { name: 'policy', id: 'C4TLXMARE'}, 
    'Data Collection / Analysis': {name: 'data', id: 'C4UEYUT9T' }, 
    'Design / Develop Platforms': {name: 'designanddevelopment', id: 'C4V2Z9S0N'}, 
    'Elections / Political Campaigns': {name: 'elections', id: 'C4UCAC1H8'}
};

var campaignZeroInfo = { name: 'campaignzero', id: 'G6S93BFV2' }; 

var addMemberToTeam = function(email, locationChannelId, interestChannelId, campaignZeroChannelId){ 
    var adminToken = process.env.ADMIN_SLACK_TOKEN; 
    var options = {
        url: 'https://slack.com/api/users.admin.invite', 
        qs: {
            token: adminToken, 
            email: email, 
            channels: ( locationChannelId + ',' + interestChannelId)
        }
    };
    
    if (campaignZeroChannelId){
        options.qs.channels = ( locationChannelId + ',' + interestChannelId + ',' + campaignZeroChannelId);
    }

    return new Promise(function(resolve, reject){
        request(options, function (err, response) {
            if (err) {
                return reject(err);
            }

            response = JSON.parse(response.body);
            if (!response.ok){
                return reject(response);
            }

            return resolve();
        });
    });
};


var transform = function(formDefinition, answers){
    var questions = formDefinition.fields;
    return questions.map(function(question){
        var answer = answers.find(function(answer){
            return answer.field.id === question.id;  
        });
        question.answer = (typeof answer[answer.type] !== 'object') ? answer[answer.type] : answer[answer.type].label; 
        return question;
    });
};

function addSingleEmailToMChimp(email){
    return new Promise(function(resolve, reject){
        request({
            method : 'post',
            url : 'https://us16.api.mailchimp.com/3.0/lists/c3427b7228/members',
            auth : {
                user : 'any',
                password : process.env.ADMIN_MAILCHIMP_PASSWORD
            },
            json : {'email_address': email, status: 'subscribed'},
        }, function (err, response) {
            if (err) {
                return reject(err);
            }

            if (response.statusCode < 200 || response.statusCode > 299) {
                return reject(new Error(response.body));
            }

            response = response.body || {};
            return resolve(response);
        });
    });
}


exports.handler = function (event, context, callback) {
    console.log('event: ', event)
    var response = {
        "statusCode": 200, 
        "headers": {"Content-Type": "application/json"}
    };
    
    var body = JSON.parse(event.body);
    var formDefinition = body.form_response.definition; 
    var formAnswers = body.form_response.answers;
    if (formDefinition.title !== 'StayWoke Signup' && formDefinition.title !== 'Campaign Zero Signup'){
        return callback(null, response);
    }
    var userResponse = transform(formDefinition, formAnswers);
    console.log('\nuserResponse', userResponse);


    // // STEP 1: email logic 
    var emailResponse = userResponse.find(function(response){ return response.type === 'email'; });
    if (!emailResponse){
        return callback(null, response); // can't do anything without email 
    }
    
    var userEmail = emailResponse.answer;
    console.log('\nuserEmail', userEmail);


    // // STEP 2: location slack channel logic
    var zipcodeResponse = userResponse.find(function(response){ return response.title === 'What is your zip code?'; });
    
    if (!zipcodeResponse){
        return callback(null, response);  // reject anyone who didn't take time to enter zip 
    }

    var zip = String(zipcodeResponse.answer); 
    var info = zipcode.lookup(zip);
    console.log('location info', info);
    if (!info || !info.length){
        return callback(null, response); 
    }
    
    var locationSlackChannel = stateToChannelMap[info[1]];
    if (!locationSlackChannel){
        return callback(null);
    }
    console.log('\locationSlackChannel', locationSlackChannel);
    var locationChannelId = locationSlackChannel.id;
    console.log('\n location slack channelId', locationChannelId);
    


    // // STEP 3: interest slack channel logic 
    var workGroup = userResponse.find(function(response){ return response.title === 'Which work group would you like to join?'; });
    if (!workGroup){
        return callback(null, response); 
    }
    console.log('\nworkGroup', workGroup);

    var interestSlackChannel = interestToChannelMap[workGroup.answer];
    if (!interestSlackChannel){
        return callback(null, response);
    }
    console.log('\interestSlackChannel', interestSlackChannel);
    var interestChannelId = interestSlackChannel.id; 
    console.log('\ninterest slack channelId', interestChannelId);

    var campaignZeroChannelId = (formDefinition.title === 'Campaign Zero Signup') ? 'G6S93BFV2' : null;
        
    return addMemberToTeam(userEmail, locationChannelId, interestChannelId, campaignZeroChannelId)
    .then(function(){
        return addSingleEmailToMChimp(userEmail);
    })
    .then(function(){
        callback(null, response);
    })
    .catch(function(err){
        console.log('err', err);
        console.log('stack', err.stack);
        callback(null, response);
    });
};




















