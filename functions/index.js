const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

// work-around for app initialization bug
try {
  admin.initializeApp();
} catch (e) {}

const cronKey = '';

const baseURL = 'https://api.sendbird.com/v3';
const applicationToken = '';
const contentType = 'application/json, charset=utf8';

function deleteFirstNode(path) {
  let keyToDelete = '';
  let location = '';
  const db = admin.database();
  db.ref(path).limitToFirst(1).once('value').then(function(nodes) {
    nodes.forEach(function(node) {
      keyToDelete = node.key;
      location = path + keyToDelete;
      db.ref(location).remove()
    })
  });
}

// fetch analytic data from sendbird once every day.
function runOnceEveryDay() {
  let userList = [];
  const db = admin.database();
  const analytics = admin.database().ref('analytics')

  const userCount = axios.get(baseURL + `/users?show_bot=false&limit=100`, {
    headers: {
      'Content-Type': contentType,
      'Api-Token': applicationToken
    },
  }).then(data => {
    userList.push(data.data);
    if (data.data.next != "") {
      return fetchNextPage(data.data.next, userList).then(() => {
        analytics.child('users').push(userList[0].users.length)

        db.ref('analytics/users/').once('value').then(snap => {
          if (snap.numChildren() > 30) {
            deleteFirstNode(`analytics/users/`);
          }
        });
      });
    } else {
      analytics.child('users').push(userList[0].users.length)

      db.ref('analytics/users/').once('value').then(snap => {
        if (snap.numChildren() > 30) {
          deleteFirstNode(`analytics/users/`);
        }
      });
    }
  }).catch(e => {
    console.log("err", e);
  })
}

exports.runOnceEveryDay = functions.https.onCall(runOnceEveryDay)

// fetchNextPage uses recursion to fetch all users through a paginated source.
function fetchNextPage(pageToken, list, urlString) {
  return axios.get(baseURL + urlString + `&token=${pageToken}`).then(data => {
    list = list.concat(data.data);
    if (data.data.next != "") {
      return fetchNextOpenChannelPage(data.data.next, openChannels, urlString);
    } else {
      return list;
    }
  })
}

exports.fetchBannedAndMutedUsers = functions.https.onCall((data, context) => {
  const firebaseToken = data.token;
  const action = data.action;
  const channelType = data.channelType;
  const channel = data.channel;

  return admin.auth().verifyIdToken(firebaseToken).then(data => {
    return axios.get(baseURL + `/${channelType}/${channel}/${action}?limit=100`,
    {
        headers: {
          'Content-Type': contentType,
          'Api-Token': applicationToken
        }
    }).then((data) => {
      return data.data
    }).catch(err => {
      return err
    })
  }).catch(e => {
    // bad token
    return e;
  })
})

exports.unBanOrUnMuteUser = functions.https.onCall((data, context) => {
  const firebaseToken = data.token;
  const action = data.action;
  const channelType = data.channelType;
  const userID = data.userID;
  const channel = data.channel;

  return admin.auth().verifyIdToken(firebaseToken).then(data => {
    return axios.delete(baseURL + `/${channelType}/${channel}/${action}/${userID}`,
    {
        headers: {
          'Content-Type': contentType,
          'Api-Token': applicationToken
        }
    }).then((data) => {
      return { message: `${user_id} has been un${action}d` }
    }).catch(err => {
      return err
    })
  }).catch(e => {
    // bad token
    return e;
  })
})

exports.banOrMuteUser = functions.https.onCall((data, context) => {
  const firebaseToken = data.token;
  const action = data.action;
  const channelType = data.channelType;
  const userID = data.userID;
  const channel = data.channel;
  //const actionDescription = data.actionDescription;

  return admin.auth().verifyIdToken(firebaseToken).then(data => {
    return axios.post(baseURL + `/${channelType}/${channel}/${action}`, {
        user_id: userID,
        description: "None",
        seconds: -1
    },
    {
        headers: {
          'Content-Type': contentType,
          'Api-Token': applicationToken
        }
    }).then((data) => {
      return { message: `${user_id} has been ${action}d` }
    }).catch(err => {
      return err
    })
  }).catch(e => {
    // bad token
    return e;
  })
})

exports.fetchChannelMembers = functions.https.onCall((data, context) => {
  const firebaseToken = data.token;
  const isGroupChannel = data.isGroupChannel;
  const channel = data.channel;

  let channelMembers = [];
  let urlString = isGroupChannel ? `/group_channels/${channel}/members?limit=100` : `/open_channels/${channel}/participants?limit=100`

  return admin.auth().verifyIdToken(firebaseToken).then(data => {
    return axios.get(baseURL + urlString, {
      headers: {
        'Content-Type': contentType,
        'Api-Token': applicationToken
      },
    }).then(data => {
      channelMembers.push(data.data);
      if (data.data.next != "") {
        return fetchNextPage(data.data.next, channelMembers, urlString );
      } else {
        return channelMembers;
      }
    }).catch(e => {
      console.log("err", e);
    })
  }).catch(e => {
    // bad token
    return e;
  })
})

exports.addPerformedAction = functions.https.onCall((data, context) => {
  const firebaseToken = data.token;
  const nickname = data.nickname;
  const date = data.date;
  const action = data.action;

  return admin.auth().verifyIdToken(firebaseToken).then(data => {
    const db = admin.database();
    db.ref('analytics/adminHistory/').push({
      nickname: nickname,
      date: date,
      action: action
    });

    db.ref('analytics/adminHistory/').once('value').then(snap => {
      if (snap.numChildren() > 30) { // remember past 30 actions; can increase but wary of db usage limits
          deleteFirstNode('analytics/adminHistory/');
      }
    })


  })
  .catch(e => {
      // bad Token
      return e;
  })
})

exports.updateUserToAdmin = functions.https.onCall((data, context) => {
  const firebaseToken = data.token;
  const userID = data.userID;
  const UID = encodeURIComponent(data.userID);

  axios.defaults.headers.common['Api-Token'] = applicationToken;
  axios.defaults.headers.common['Content-Type'] = contentType;

  return admin.auth().verifyIdToken(firebaseToken).then(data => {
    // token verified -> add admin tag to user data
    return axios.put(baseURL + `/users/${UID}`, {
      headers: {
        'Content-Type': contentType,
        'Api-Token': applicationToken
      },
      upsert: true,
      metadata: {
        'user-type': 'admin'
      }
    })
  }).catch(e => {
    // bad Token
    return e;
  })
})

exports.fetchUserList = functions.https.onCall((data, context) => {
  const firebaseToken = data.token;
  let userList = [];
  let urlString = `/users?show_bot=false&limit=100`;

  axios.defaults.headers.common['Api-Token'] = applicationToken;
  axios.defaults.headers.common['Content-Type'] = contentType;

  return admin.auth().verifyIdToken(firebaseToken).then(data => {
    return axios.get(baseURL + urlString, {
      headers: {
        'Content-Type': contentType,
        'Api-Token': applicationToken
      },
    }).then(data => {
      userList.push(data.data);
      if (data.data.next != "") {
        return fetchNextPage(data.data.next, userList, urlString);
      } else {
        return userList;
      }
    }).catch(e => {
      console.log("err", e);
    })
  }).catch(e => {
    // bad Token
    return e;
  })
})

exports.fetchOpenChannels = functions.https.onCall((data, context) => {
  const firebaseToken = data.token;
  let openChannels = [];
  let urlString = `/open_channels?limit=100`

  axios.defaults.headers.common['Api-Token'] = applicationToken;
  axios.defaults.headers.common['Content-Type'] = contentType;

  return admin.auth().verifyIdToken(firebaseToken).then(data => {
    return axios.get(baseURL + urlString, {
      headers: {
        'Content-Type': contentType,
        'Api-Token': applicationToken
      },
    }).then(data => {
      console.log("data", data.data);

      openChannels.push(data.data);
      if (data.data.next != "") {
        return fetchNextPage(data.data.next, openChannels, urlString);
      } else {
        return openChannels;
      }
    }).catch(e => {
      console.log("err", e);
    })
  }).catch(e => {
    // bad Token
    return e;
  })
})

exports.fetchGroupChannels = functions.https.onCall((data, context) => {
  const firebaseToken = data.token;
  let groupChannels = [];
  let urlString = `/group_channels?limit=100`

  axios.defaults.headers.common['Api-Token'] = applicationToken;
  axios.defaults.headers.common['Content-Type'] = contentType;

  return admin.auth().verifyIdToken(firebaseToken).then(data => {
    return axios.get(baseURL + urlString, {
      headers: {
        'Content-Type': contentType,
        'Api-Token': applicationToken
      },
    }).then(data => {
      console.log("data", data.data);

      groupChannels.push(data.data);
      if (data.data.next != "") {
        return fetchNextPage(data.data.next, groupChannels, urlString);
      } else {
        return groupChannels;
      }
    }).catch(e => {
      console.log("err", e);
    })
  }).catch(e => {
    // bad Token
    return e;
  })
})

exports.fetchUserwithUserID = functions.https.onCall((data, context) => {
  const firebaseToken = data.token;
  const userID = data.userID;
  const UID = encodeURIComponent(userID);

  axios.defaults.headers.common['Api-Token'] = applicationToken;
  axios.defaults.headers.common['Content-Type'] = contentType;

  return admin.auth().verifyIdToken(firebaseToken).then(data => {
    return axios.get(baseURL + `/users/${UID}`,  {
      headers: {
        'Content-Type': contentType,
        'Api-Token': applicationToken
      }
    }).then(data => {
      return data.data;
    })
  }).catch(data => {
    return data;
  })
})

exports.createEvent = functions.https.onCall((data, context) => {
  const firebaseToken = data.token;

})

exports.getSendbirdUserWithToken = functions.https.onCall((data, context) => {
  const firebaseToken = data.token;
  const userID = data.userID;
  const UID = encodeURIComponent(data.userID); // sendbird API requires browser safe strings, and since UID's are emails, we have to encode.
  const nickname = data.nickname;

  axios.defaults.headers.common['Api-Token'] = applicationToken;
  axios.defaults.headers.common['Content-Type'] = contentType;

  // verify requester's token
  return admin.auth().verifyIdToken(firebaseToken)
  .then(data => {
    // token is tried and true!
    // check if sendbird user exists using the platform API
    return axios.get(baseURL + `/users?limit=1&show_bot=false&user_ids=${UID}&active_mode=all`, {
          headers: {
            'Content-Type': contentType,
            'Api-Token': applicationToken
          }
      }).then(res => {
        // check if user exists in sendbird database
        if (res.data.users.length > 0) {
          // user already exists -> make sure user has been issued sendbird token and return it to client
          return axios.get(baseURL + `/users/${UID}`, {
            headers: {
              'Content-Type': contentType,
              'Api-Token': applicationToken
            }
          }).then(res => {
            if (res.data.access_token) {
              return { token: res.data.access_token, firstLogin: false, nickname: res.data.nickname }
            } else {
              // user exists but does not have an issued access token -> change that
              return axios.put(baseURL + `/users/${UID}`, {
                  issue_access_token: true
              },
              {
                  headers: {
                    'Content-Type': contentType,
                    'Api-Token': applicationToken
                  }
              }).then(res => {
                // now that user has an access token, return it to the client
                return { token: res.data.access_token, firstLogin: true }
              }).catch(err => {
                return err;
              })
            }
          }).catch(err => {
            return err
          })
        } else {
          // user does not exist in sendbird database -> create user
          return axios.post(baseURL + `/users`, {
              user_id: userID,
              nickname: nickname,
              issue_access_token: true,
              profile_url: '',
          },
          {
              headers: {
                'Content-Type': contentType,
                'Api-Token': applicationToken
              }
          }).then(res => {
            // once user is created send their access token back to client
            return { token: res.data.access_token, firstLogin: true }
          }).catch(err => {
            return err
          })
        }
    }).catch(err => {
      return err;
    })
  })
  .catch(err => {
    // impostor!
    return err
  });
});

exports.getCalendarEvents = functions.https.onCall((data, context) => {
  const firebaseToken = data.firebaseToken;
  const calendarID = "jfschmiechen@gmail.com";

  const API_KEY = "";

  // verify requester's token
  return admin.auth().verifyIdToken(firebaseToken).then((data) => {
    // fetch events of public calendar
    return axios.get(encodeURI(`https://content.googleapis.com/calendar/v3/calendars/${calendarID}/events?key=${API_KEY}`)).then((res) => {
      return res.data;
    })
    .catch((error) => {
      // failed to retrieve calendar events
      console.log("failed to retrieve calendar events", error);
      return error;
    })
  })
  .catch((error) => {
    // bad Token
    console.log("bad credentials", error);
    return error;
  })
})
